import Foundation

/// How often a filter's alerts go out. Raw values are the server's `alert_frequency` values.
enum AlertFrequency: String, Codable, CaseIterable, Hashable {
    case instant
    case hourly = "hourly_digest"
    case daily = "daily_digest"
    /// No alerts go out; the filter is checked by hand.
    case off = "manual"

    var displayName: String {
        switch self {
        case .instant: "Instant"
        case .hourly: "Hourly"
        case .daily: "Daily"
        case .off: "Off"
        }
    }
}
