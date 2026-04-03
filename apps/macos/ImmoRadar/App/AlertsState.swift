import Foundation

@MainActor @Observable
final class AlertsState {
    var unreadAlertCount: Int = 0

    var notificationsEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "notificationsEnabled") }
        set { UserDefaults.standard.set(newValue, forKey: "notificationsEnabled") }
    }

    var notifyOnNewMatch: Bool {
        get { UserDefaults.standard.object(forKey: "notifyOnNewMatch") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "notifyOnNewMatch") }
    }

    var notifyOnPriceDrop: Bool {
        get { UserDefaults.standard.object(forKey: "notifyOnPriceDrop") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "notifyOnPriceDrop") }
    }

    var notifyOnScoreChange: Bool {
        get { UserDefaults.standard.object(forKey: "notifyOnScoreChange") as? Bool ?? false }
        set { UserDefaults.standard.set(newValue, forKey: "notifyOnScoreChange") }
    }

    func handleStreamAlert(_ alert: Alert) {
        unreadAlertCount += 1

        guard notificationsEnabled else { return }

        let shouldNotify: Bool
        switch alert.alertType {
        case .newMatch:
            shouldNotify = notifyOnNewMatch
        case .priceDrop:
            shouldNotify = notifyOnPriceDrop
        case .scoreUpgrade, .scoreDowngrade:
            shouldNotify = notifyOnScoreChange
        case .statusChange:
            shouldNotify = notifyOnNewMatch
        }

        if shouldNotify {
            NotificationManager.shared.postAlertNotification(
                title: alert.title,
                body: alert.body
            )
        }
    }

    func refreshUnreadCount(using client: APIClient) async {
        do {
            unreadAlertCount = try await client.fetchUnreadCount()
        } catch {
            // keep last known count
        }
    }

    func connectStreamIfNeeded(
        _ stream: AlertStreamService,
        baseURL: String,
        token: String?
    ) {
        guard !stream.isConnected else { return }
        stream.connect(baseURL: baseURL, token: token)
    }

    func disconnectStream(_ stream: AlertStreamService) {
        stream.disconnect()
    }
}
