import Foundation

/// How often a filter's alerts go out. Raw values are the server's `alert_frequency` values.
enum AlertFrequency: String, Codable, CaseIterable, Hashable {
    case instant
    case hourly = "hourly_digest"
    case daily = "daily_digest"
    /// No alerts go out; the filter is checked by hand.
    case off = "manual"

    /// The choices the filter editor offers. The server runs no digests yet, so `hourly_digest`
    /// and `daily_digest` alert like `instant` (`findMatchingFilters` in packages/db).
    static let editorChoices: [AlertFrequency] = [.instant, .off]

    /// How the server delivers this frequency's alerts: a digest goes out like instant.
    var delivery: AlertFrequency {
        self == .off ? .off : .instant
    }

    var displayName: String {
        switch self {
        case .instant: "Instant"
        case .hourly: "Hourly"
        case .daily: "Daily"
        case .off: "Off"
        }
    }
}
