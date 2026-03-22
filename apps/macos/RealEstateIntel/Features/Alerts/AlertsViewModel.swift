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

    // MARK: - Computed

    var filteredAlerts: [Alert] {
        guard let status = filterStatus else { return alerts }
        return alerts.filter { $0.status == status }
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

    func dismiss(_ alert: Alert, using client: APIClient) async {
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
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
