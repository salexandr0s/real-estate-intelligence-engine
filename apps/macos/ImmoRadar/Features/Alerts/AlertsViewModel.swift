import Foundation

/// View model for listing alerts with filtering by status.
@MainActor @Observable
final class AlertsViewModel {

    // MARK: - State

    var alerts: [Alert] = []
    var isLoading: Bool = false
    var errorMessage: String?
    var selectedAlertID: Int?
    var filterStatus: AlertStatus?
    var searchText: String = ""

    // MARK: - Computed

    var filteredAlerts: [Alert] {
        var result = alerts
        if let status = filterStatus {
            result = result.filter { $0.status == status }
        }
        if !searchText.isEmpty {
            result = result.filter {
                $0.title.localizedStandardContains(searchText)
                    || $0.body.localizedStandardContains(searchText)
            }
        }
        return result
    }

    var unreadCount: Int {
        alerts.count(where: { $0.status == .unread })
    }

    var selectedAlert: Alert? {
        guard let id = selectedAlertID else { return nil }
        return alerts.first { $0.id == id }
    }

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        do {
            alerts = try await client.fetchAlerts(query: AlertQuery())
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func markAsRead(_ alert: Alert, using client: APIClient) async {
        do {
            try await client.markAlertRead(id: alert.id)
            if let idx = alerts.firstIndex(where: { $0.id == alert.id }) {
                alerts[idx].status = .opened
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func markAllRead(using client: APIClient) async {
        do {
            _ = try await client.bulkUpdateAlerts(filterStatus: "sent", action: "opened")
            for i in alerts.indices {
                if alerts[i].status == .unread {
                    alerts[i].status = .opened
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func dismissAll(using client: APIClient) async {
        do {
            _ = try await client.bulkUpdateAlerts(filterStatus: "sent", action: "dismissed")
            for i in alerts.indices {
                if alerts[i].status != .dismissed {
                    alerts[i].status = .dismissed
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Insert a streamed alert if not already present (deduplicated by ID).
    func insertStreamAlert(_ alert: Alert) {
        guard !alerts.contains(where: { $0.id == alert.id }) else { return }
        alerts.insert(alert, at: 0)
    }

    func dismiss(_ alert: Alert, using client: APIClient, undoManager: UndoManager? = nil) async {
        let previousStatus = alert.status
        let body: Data
        do {
            body = try JSONEncoder().encode(APIAlertUpdateRequest(status: "dismissed"))
        } catch {
            errorMessage = error.localizedDescription
            return
        }

        do {
            try await client.requestVoid(.updateAlert(id: alert.id, body: body))
            if let idx = alerts.firstIndex(where: { $0.id == alert.id }) {
                alerts[idx].status = .dismissed
            }
            // Register undo: revert to previous status
            undoManager?.registerUndo(withTarget: self) { vm in
                Task { @MainActor in
                    let revertBody = try? JSONEncoder().encode(APIAlertUpdateRequest(status: previousStatus.rawValue))
                    if let revertBody {
                        try? await client.requestVoid(.updateAlert(id: alert.id, body: revertBody))
                    }
                    if let idx = vm.alerts.firstIndex(where: { $0.id == alert.id }) {
                        vm.alerts[idx].status = previousStatus
                    }
                }
            }
            undoManager?.setActionName("Dismiss Alert")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
