import Foundation

enum AlertType: String, Codable, CaseIterable, Hashable {
    case newMatch = "new_match"
    case priceDrop = "price_drop"
    case scoreUpgrade = "score_upgrade"
    case scoreDowngrade = "score_downgrade"
    case statusChange = "status_change"

    var displayName: String {
        switch self {
        case .newMatch: "New Match"
        case .priceDrop: "Price Drop"
        case .scoreUpgrade: "Score Upgrade"
        case .scoreDowngrade: "Score Downgrade"
        case .statusChange: "Status Change"
        }
    }

    var iconName: String {
        switch self {
        case .newMatch: "sparkles"
        case .priceDrop: "arrow.down.circle.fill"
        case .scoreUpgrade: "arrow.up.circle.fill"
        case .scoreDowngrade: "arrow.down.circle"
        case .statusChange: "arrow.triangle.2.circlepath"
        }
    }
}
