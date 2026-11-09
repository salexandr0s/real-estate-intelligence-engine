import Foundation

@MainActor @Observable
final class AlertsState {
    private enum Key {
        static let notificationsEnabled = "notificationsEnabled"
        static let notifyOnNewMatch = "notifyOnNewMatch"
        static let notifyOnPriceDrop = "notifyOnPriceDrop"
        static let notifyOnScoreChange = "notifyOnScoreChange"
    }

    static let notificationsDeniedHint =
        "Allow notifications for ImmoRadar in System Settings > Notifications."

    var unreadAlertCount: Int = 0

    // Stored, so SwiftUI sees each change. Each loads from UserDefaults at init and writes back.
    var notificationsEnabled: Bool {
        didSet { defaults.set(notificationsEnabled, forKey: Key.notificationsEnabled) }
    }

    var notifyOnNewMatch: Bool {
        didSet { defaults.set(notifyOnNewMatch, forKey: Key.notifyOnNewMatch) }
    }

    var notifyOnPriceDrop: Bool {
        didSet { defaults.set(notifyOnPriceDrop, forKey: Key.notifyOnPriceDrop) }
    }

    var notifyOnScoreChange: Bool {
        didSet { defaults.set(notifyOnScoreChange, forKey: Key.notifyOnScoreChange) }
    }

    /// Shown under Enable Notifications after macOS refused permission.
    private(set) var notificationPermissionHint: String?

    @ObservationIgnored
    private let defaults: UserDefaults

    /// Ids of the streamed alerts already counted and notified, so a repeated delivery of the
    /// same alert changes nothing.
    @ObservationIgnored
    private var handledStreamAlertIDs: Set<Int> = []

    @ObservationIgnored
    private var streamConsumer: Task<Void, Never>?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        notificationsEnabled = defaults.bool(forKey: Key.notificationsEnabled)
        notifyOnNewMatch = defaults.object(forKey: Key.notifyOnNewMatch) as? Bool ?? true
        notifyOnPriceDrop = defaults.object(forKey: Key.notifyOnPriceDrop) as? Bool ?? true
        notifyOnScoreChange = defaults.object(forKey: Key.notifyOnScoreChange) as? Bool ?? false
    }

    // MARK: - Notifications

    /// Turning notifications on asks macOS for permission. When the user denies it, now or
    /// earlier, the switch goes back off and the hint says where to allow it.
    func setNotificationsEnabled(_ isEnabled: Bool) async {
        notificationPermissionHint = nil
        guard isEnabled else {
            notificationsEnabled = false
            return
        }

        // On first, so the switch moves while macOS shows its prompt.
        notificationsEnabled = true
        let isAllowed = await NotificationManager.shared.requestAuthorization()
        notificationsEnabled = isAllowed
        if !isAllowed {
            notificationPermissionHint = Self.notificationsDeniedHint
        }
    }

    // MARK: - Stream

    /// Counts a streamed alert as unread and posts its notification, once per alert id.
    func handleStreamAlert(_ alert: Alert) {
        guard handledStreamAlertIDs.insert(alert.id).inserted else { return }
        unreadAlertCount += 1

        guard notificationsEnabled else { return }

        let shouldNotify: Bool
        switch alert.alertType {
        case .newMatch:
            shouldNotify = notifyOnNewMatch
        case .priceDrop, .priceChange:
            shouldNotify = notifyOnPriceDrop
        case .scoreUpgrade:
            shouldNotify = notifyOnScoreChange
        case .statusChange, .digest:
            shouldNotify = notifyOnNewMatch
        case .sourceDegraded, .unknown:
            shouldNotify = false
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

    /// Starts handling the stream's alerts, then opens the stream unless it is open.
    func connectStreamIfNeeded(
        _ stream: AlertStreamService,
        baseURL: String,
        token: String?
    ) {
        startHandlingAlerts(from: stream)
        guard !stream.isConnected else { return }
        stream.connect(baseURL: baseURL, token: token)
    }

    func disconnectStream(_ stream: AlertStreamService) {
        stream.disconnect()
    }

    /// Takes every alert the stream delivers, for as long as this state lives. A disconnect
    /// doesn't end it, so the next connection's alerts arrive here too.
    func startHandlingAlerts(from stream: AlertStreamService) {
        guard streamConsumer == nil else { return }
        let alerts = stream.alerts()
        streamConsumer = Task { [weak self] in
            for await alert in alerts {
                self?.handleStreamAlert(alert)
            }
        }
    }
}
