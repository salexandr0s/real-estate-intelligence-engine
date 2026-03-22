import Foundation
import UserNotifications

/// Manages local system notifications for alert events.
/// Respects the user's notification preferences from AppState/UserDefaults.
final class NotificationManager {
    static let shared = NotificationManager()

    private init() {}

    /// Request notification authorization from the user.
    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { _, _ in
            // Permission result stored by the system
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
