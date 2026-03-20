import Foundation

enum AlertStatus: String, Codable, CaseIterable, Hashable {
    case unread
    case opened
    case dismissed

    var displayName: String {
        switch self {
        case .unread: "Unread"
        case .opened: "Opened"
        case .dismissed: "Dismissed"
        }
    }
}
