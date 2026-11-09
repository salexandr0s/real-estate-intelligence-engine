import Foundation
import UserNotifications

/// Manages local system notifications for alert events.
/// Respects the user's notification preferences from AppState/UserDefaults.
@MainActor
final class NotificationManager: Sendable {
    static let shared = NotificationManager()

    private init() {}

    /// Asks macOS for permission to post notifications and returns whether ImmoRadar may post
    /// them. macOS shows its prompt only once; after that this returns the stored answer, so it
    /// returns false when the user denied permission earlier. `AlertsState` calls this when
    /// notifications are turned on, and at launch when they are already on.
    func requestAuthorization() async -> Bool {
        do {
            return try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .badge, .sound]
            )
        } catch {
            Log.ui.error("Notification permission request failed: \(error, privacy: .public)")
            return false
        }
    }

    /// Post a local notification for an alert event.
    func postAlertNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil // Deliver immediately
        )
        UNUserNotificationCenter.current().add(request)
    }
}
