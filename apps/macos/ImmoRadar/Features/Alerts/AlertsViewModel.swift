import Foundation

enum AlertsScope: String, CaseIterable, Hashable {
    case unread
    case active
    case dismissed
    case all

    var displayName: String {
        switch self {
        case .unread: "Unread"
        case .active: "Active"
        case .dismissed: "Dismissed"
        case .all: "All"
        }
    }
}

/// View model for listing alerts with filtering by status.
@MainActor @Observable
final class AlertsViewModel {

    // MARK: - State

    var alerts: [Alert] = []
    var isLoading: Bool = false
    var errorMessage: String?
    var selectedAlertID: Int?
    var scope: AlertsScope = .unread {
        didSet { normalizeSelection(preferredID: selectedAlertID) }
    }
    var searchText: String = "" {
        didSet { normalizeSelection(preferredID: selectedAlertID) }
    }

    // MARK: - Computed

    var scopedAlerts: [Alert] {
        var result = alerts
        switch scope {
        case .unread:
            result = result.filter { $0.status == .unread }
        case .active:
            result = result.filter { $0.status == .unread || $0.status == .opened }
        case .dismissed:
            result = result.filter { $0.status == .dismissed }
        case .all:
            break
        }
        return result
    }

    var visibleAlerts: [Alert] {
        var result = scopedAlerts
        if !searchText.isEmpty {
            result = result.filter(matchesSearch)
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

    var visibleCount: Int {
        visibleAlerts.count
    }

    var hasAnyAlerts: Bool {
        !alerts.isEmpty
    }

    private func matchesSearch(_ alert: Alert) -> Bool {
        let query = searchText
        guard !query.isEmpty else { return true }

        let keywords = alert.matchReasons?.matchedKeywords ?? []
        let thresholdTokens = [
            alert.matchReasons?.thresholdsMet?.price == true ? "price" : nil,
            alert.matchReasons?.thresholdsMet?.area == true ? "area" : nil,
            alert.matchReasons?.thresholdsMet?.rooms == true ? "rooms" : nil,
            alert.matchReasons?.thresholdsMet?.score == true ? "score" : nil,
            alert.matchReasons?.districtMatch == true ? "district" : nil,
        ].compactMap { $0 }

        let haystack = [
            alert.title,
            alert.body,
            alert.filterName,
            alert.listing?.title,
            alert.listing?.districtName,
            alert.listing?.city,
            keywords.joined(separator: " "),
            thresholdTokens.joined(separator: " "),
        ]
            .compactMap { $0 }
            .joined(separator: " ")

        return haystack.localizedStandardContains(query)
    }

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        do {
            alerts = try await client.fetchAlerts(query: AlertQuery())
            normalizeSelection(preferredID: selectedAlertID)
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
            normalizeSelection(preferredID: alert.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func markVisibleRead(using client: APIClient) async {
        let ids = visibleAlerts
            .filter { $0.status == .unread }
            .map(\.id)

        guard !ids.isEmpty else { return }

        do {
            _ = try await client.bulkUpdateAlerts(ids: ids, action: "opened")
            for i in alerts.indices {
                if ids.contains(alerts[i].id), alerts[i].status == .unread {
                    alerts[i].status = .opened
                }
            }
            normalizeSelection(preferredID: selectedAlertID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func dismissVisible(using client: APIClient) async {
        let ids = visibleAlerts
            .filter { $0.status != .dismissed }
            .map(\.id)

        guard !ids.isEmpty else { return }

        do {
            _ = try await client.bulkUpdateAlerts(ids: ids, action: "dismissed")
            for i in alerts.indices {
                if ids.contains(alerts[i].id), alerts[i].status != .dismissed {
                    alerts[i].status = .dismissed
                }
            }
            normalizeSelection(preferredID: selectedAlertID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Insert a streamed alert if not already present (deduplicated by ID).
    func insertStreamAlert(_ alert: Alert) {
        if let existingIndex = alerts.firstIndex(where: { $0.id == alert.id }) {
            alerts[existingIndex] = alert
        } else {
            alerts.insert(alert, at: 0)
        }
        normalizeSelection(preferredID: selectedAlertID)
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
            normalizeSelection(preferredID: alert.id)
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
                    vm.normalizeSelection(preferredID: alert.id)
                }
            }
            undoManager?.setActionName("Dismiss Alert")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearError() {
        errorMessage = nil
    }

    private func normalizeSelection(preferredID: Int?) {
        let visibleIDs = Set(visibleAlerts.map(\.id))

        if let preferredID, visibleIDs.contains(preferredID) {
            selectedAlertID = preferredID
            return
        }

        if let selectedAlertID, visibleIDs.contains(selectedAlertID) {
            return
        }

        selectedAlertID = visibleAlerts.first?.id
    }
}
