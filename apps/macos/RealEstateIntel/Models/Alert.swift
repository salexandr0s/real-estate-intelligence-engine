import Foundation

/// Alert generated when a listing matches a saved filter.
/// Maps to the `/v1/alerts` API resource.
struct Alert: Identifiable, Codable, Hashable {
    let id: Int
    let alertType: AlertType
    var status: AlertStatus
    let title: String
    let body: String
    let matchedAt: Date
    let filterName: String?
    let listingId: Int?
    let listing: Listing?
}

// MARK: - Enums

enum AlertType: String, Codable, CaseIterable, Hashable {
    case newMatch = "new_match"
    case priceDrop = "price_drop"
    case scoreUpgrade = "score_upgrade"
    case scoreDowngrade = "score_downgrade"
    case statusChange = "status_change"

    var displayName: String {
        switch self {
        case .newMatch: return "New Match"
        case .priceDrop: return "Price Drop"
        case .scoreUpgrade: return "Score Upgrade"
        case .scoreDowngrade: return "Score Downgrade"
        case .statusChange: return "Status Change"
        }
    }

    var iconName: String {
        switch self {
        case .newMatch: return "sparkles"
        case .priceDrop: return "arrow.down.circle.fill"
        case .scoreUpgrade: return "arrow.up.circle.fill"
        case .scoreDowngrade: return "arrow.down.circle"
        case .statusChange: return "arrow.triangle.2.circlepath"
        }
    }
}

enum AlertStatus: String, Codable, CaseIterable, Hashable {
    case unread
    case opened
    case dismissed

    var displayName: String {
        switch self {
        case .unread: return "Unread"
        case .opened: return "Opened"
        case .dismissed: return "Dismissed"
        }
    }
}

// MARK: - Mock Data

extension Alert {
    static let samples: [Alert] = [
        Alert(
            id: 1,
            alertType: .newMatch,
            status: .unread,
            title: "New match: Sonnige 3-Zimmer nahe Prater",
            body: "Score 87.3 -- EUR 299,000 -- 72.5 sqm -- Leopoldstadt",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -1, to: Date())!,
            filterName: "Vienna Value Apartments",
            listingId: 1,
            listing: Listing.samples[0]
        ),
        Alert(
            id: 2,
            alertType: .priceDrop,
            status: .unread,
            title: "Price drop: Preisreduziert! Helle 3-Zimmer nahe U3",
            body: "Price reduced from EUR 359,000 to EUR 335,000 (-6.7%)",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -2, to: Date())!,
            filterName: "Vienna Value Apartments",
            listingId: 8,
            listing: Listing.samples[7]
        ),
        Alert(
            id: 3,
            alertType: .newMatch,
            status: .unread,
            title: "New match: Provisionsfrei! Renovierte Altbauwohnung",
            body: "Score 82.1 -- EUR 245,000 -- 58.0 sqm -- Landstrasse",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -4, to: Date())!,
            filterName: "Vienna Value Apartments",
            listingId: 2,
            listing: Listing.samples[1]
        ),
        Alert(
            id: 4,
            alertType: .scoreUpgrade,
            status: .opened,
            title: "Score upgrade: Erstbezug nach Sanierung",
            body: "Score increased from 62.1 to 78.5 after price correction",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -8, to: Date())!,
            filterName: "Large Family Apartments",
            listingId: 3,
            listing: Listing.samples[2]
        ),
        Alert(
            id: 5,
            alertType: .newMatch,
            status: .opened,
            title: "New match: Anlage-Hit in Top-Lage",
            body: "Score 71.2 -- EUR 219,000 -- 48.3 sqm -- Neubau",
            matchedAt: Calendar.current.date(byAdding: .day, value: -1, to: Date())!,
            filterName: "Vienna Value Apartments",
            listingId: 4,
            listing: Listing.samples[3]
        ),
        Alert(
            id: 6,
            alertType: .priceDrop,
            status: .dismissed,
            title: "Price drop: Dachgeschoss-Maisonette mit Terrasse",
            body: "Price reduced from EUR 549,000 to EUR 520,000 (-5.3%)",
            matchedAt: Calendar.current.date(byAdding: .day, value: -2, to: Date())!,
            filterName: nil,
            listingId: 5,
            listing: Listing.samples[4]
        ),
        Alert(
            id: 7,
            alertType: .statusChange,
            status: .dismissed,
            title: "Status change: Garconniere zur Kapitalanlage",
            body: "Listing status changed to inactive",
            matchedAt: Calendar.current.date(byAdding: .day, value: -3, to: Date())!,
            filterName: "Sub-4000 EUR/sqm Deals",
            listingId: 6,
            listing: Listing.samples[5]
        ),
    ]
}
