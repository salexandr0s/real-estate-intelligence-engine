import Foundation

/// An inbox alert's status. The server stores `queued`, `sent`, `opened`, `dismissed`, `failed`
/// and `suppressed`; the app shows `queued` and `sent` together as unread.
enum AlertStatus: String, Codable, CaseIterable, Hashable {
    case unread
    case opened
    case dismissed
    case failed
    case suppressed

    /// The status for a server value. `queued`, `sent` and values the app doesn't know read as unread.
    init(serverValue: String) {
        switch serverValue {
        case "queued", "sent": self = .unread
        default: self = AlertStatus(rawValue: serverValue) ?? .unread
        }
    }

    init(from decoder: any Decoder) throws {
        self.init(serverValue: try decoder.singleValueContainer().decode(String.self))
    }

    /// The value to send in PATCH /v1/alerts/:id. The server has no `unread`, so unread goes back as `sent`.
    var serverValue: String {
        self == .unread ? "sent" : rawValue
    }

    var displayName: String {
        switch self {
        case .unread: "Unread"
        case .opened: "Opened"
        case .dismissed: "Dismissed"
        case .failed: "Failed"
        case .suppressed: "Suppressed"
        }
    }
}
