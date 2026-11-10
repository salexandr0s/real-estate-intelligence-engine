import Foundation

/// Saved listing item matching the API response shape.
struct SavedListingItem: Identifiable, Codable, Sendable {
    let id: Int
    let listingId: Int
    var notes: String?
    let savedAt: String
    let listing: SavedListingDetail

    struct SavedListingDetail: Codable, Sendable {
        let id: Int
        let listingUid: String
        let sourceCode: String
        let title: String
        let canonicalUrl: String
        let operationType: String
        let propertyType: String
        let city: String
        let districtNo: Int?
        let districtName: String?
        let listPriceEur: Double?
        var isProject: Bool? = nil
        var priceFromEurCents: Int? = nil

        var formattedPrice: String {
            PriceFormatter.formatListingPrice(askingEur: listPriceEur.map(Int.init), fromCents: priceFromEurCents)
        }
        let livingAreaSqm: Double?
        let rooms: Double?
        let pricePerSqmEur: Double?
        let currentScore: Double?
        let firstSeenAt: String
        let listingStatus: String
    }

    var parsedSavedAt: Date? {
        Date.fromISO(savedAt)
    }
}
