import Foundation

enum AlertFrequency: String, Codable, CaseIterable, Hashable {
    case instant
    case hourly
    case daily
    case weekly
    case off

    var displayName: String {
        switch self {
        case .instant: "Instant"
        case .hourly: "Hourly"
        case .daily: "Daily"
        case .weekly: "Weekly"
        case .off: "Off"
        }
    }
}
