import Foundation

/// The kind of an alert, as the server's `alert_type` names it.
enum AlertType: String, Codable, CaseIterable, Hashable {
    case newMatch = "new_match"
    case priceDrop = "price_drop"
    case priceChange = "price_change"
    case scoreUpgrade = "score_upgrade"
    case statusChange = "status_change"
    case digest
    case sourceDegraded = "source_degraded"
    /// A type this version of the app doesn't know.
    case unknown

    /// An unknown type decodes as `.unknown`, so one new server value can't fail a whole list.
    init(from decoder: any Decoder) throws {
        let rawValue = try decoder.singleValueContainer().decode(String.self)
        self = AlertType(rawValue: rawValue) ?? .unknown
    }

    var displayName: String {
        switch self {
        case .newMatch: "New Match"
        case .priceDrop: "Price Drop"
        case .priceChange: "Price Change"
        case .scoreUpgrade: "Score Upgrade"
        case .statusChange: "Status Change"
        case .digest: "Digest"
        case .sourceDegraded: "Source Degraded"
        case .unknown: "Alert"
        }
    }

    var iconName: String {
        switch self {
        case .newMatch: "sparkles"
        case .priceDrop: "arrow.down.circle.fill"
        case .priceChange: "arrow.up.arrow.down.circle"
        case .scoreUpgrade: "arrow.up.circle.fill"
        case .statusChange: "arrow.triangle.2.circlepath"
        case .digest: "tray.full"
        case .sourceDegraded: "exclamationmark.triangle"
        case .unknown: "bell"
        }
    }
}
