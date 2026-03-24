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
    let matchReasons: AlertMatchReasons?
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
            matchedAt: Calendar.current.date(byAdding: .hour, value: -1, to: .now) ?? .now,
            filterName: "Vienna Value Apartments",
            listingId: 1,
            matchReasons: nil
        ),
        Alert(
            id: 2,
            alertType: .priceDrop,
            status: .unread,
            title: "Price drop: Preisreduziert! Helle 3-Zimmer nahe U3",
            body: "Price reduced from EUR 359,000 to EUR 335,000 (-6.7%)",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -2, to: .now) ?? .now,
            filterName: "Vienna Value Apartments",
            listingId: 8,
            matchReasons: nil
        ),
        Alert(
            id: 3,
            alertType: .newMatch,
            status: .unread,
            title: "New match: Provisionsfrei! Renovierte Altbauwohnung",
            body: "Score 82.1 -- EUR 245,000 -- 58.0 sqm -- Landstrasse",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -4, to: .now) ?? .now,
            filterName: "Vienna Value Apartments",
            listingId: 2,
            matchReasons: nil
        ),
        Alert(
            id: 4,
            alertType: .scoreUpgrade,
            status: .opened,
            title: "Score upgrade: Erstbezug nach Sanierung",
            body: "Score increased from 62.1 to 78.5 after price correction",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -8, to: .now) ?? .now,
            filterName: "Large Family Apartments",
            listingId: 3,
            matchReasons: nil
        ),
        Alert(
            id: 5,
            alertType: .newMatch,
            status: .opened,
            title: "New match: Anlage-Hit in Top-Lage",
            body: "Score 71.2 -- EUR 219,000 -- 48.3 sqm -- Neubau",
            matchedAt: Calendar.current.date(byAdding: .day, value: -1, to: .now) ?? .now,
            filterName: "Vienna Value Apartments",
            listingId: 4,
            matchReasons: nil
        ),
        Alert(
            id: 6,
            alertType: .priceDrop,
            status: .dismissed,
            title: "Price drop: Dachgeschoss-Maisonette mit Terrasse",
            body: "Price reduced from EUR 549,000 to EUR 520,000 (-5.3%)",
            matchedAt: Calendar.current.date(byAdding: .day, value: -2, to: .now) ?? .now,
            filterName: nil,
            listingId: 5,
            matchReasons: nil
        ),
        Alert(
            id: 7,
            alertType: .statusChange,
            status: .dismissed,
            title: "Status change: Garconniere zur Kapitalanlage",
            body: "Listing status changed to inactive",
            matchedAt: Calendar.current.date(byAdding: .day, value: -3, to: .now) ?? .now,
            filterName: "Sub-4000 EUR/sqm Deals",
            listingId: 6,
            matchReasons: nil
        ),
    ]
}
