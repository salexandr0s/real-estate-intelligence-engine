import Foundation

// MARK: - Filter DTOs

struct APIFilterResponse: Codable {
    let id: Int
    let name: String
    let filterKind: String
    let isActive: Bool
    let operationType: String?
    let propertyTypes: [String]?
    let districts: [Int]?
    /// Euros, with cents when the stored price has them, so they decode as Double. Read them
    /// through `wholeEuroMinPrice` and `wholeEuroMaxPrice`.
    let minPriceEur: Double?
    let maxPriceEur: Double?
    let minAreaSqm: Double?
    let maxAreaSqm: Double?
    /// NUMERIC(4,1) on the server, so 2.5 rooms arrives as 2.5.
    let minRooms: Double?
    let maxRooms: Double?
    let minScore: Double?
    let requiredKeywords: [String]?
    let excludedKeywords: [String]?
    let sortBy: String?
    let alertFrequency: String?
    let alertChannels: [String]?
    let createdAt: String
    let updatedAt: String
    let matchCount: Int?
}

extension APIFilterResponse {
    /// The app works in whole euros. Both limits round outward, so the range it shows and sends
    /// back still matches every listing the stored range matched.
    var wholeEuroMinPrice: Int? { minPriceEur.flatMap { Int(exactly: $0.rounded(.down)) } }
    var wholeEuroMaxPrice: Int? { maxPriceEur.flatMap { Int(exactly: $0.rounded(.up)) } }
}

/// The body of POST /v1/filters, and of a PATCH that replaces the whole criteria set.
/// On a PATCH, a criteria field left out (nil) is cleared on the server.
struct APICreateFilterRequest: Codable {
    let name: String
    /// `alert` or `listing_search` (`FilterKind`). The PATCH schema ignores it.
    let filterKind: String
    let operationType: String?
    let propertyTypes: [String]
    let districts: [Int]
    let minPriceEur: Int?
    let maxPriceEur: Int?
    let minAreaSqm: Double?
    let maxAreaSqm: Double?
    let minRooms: Double?
    let maxRooms: Double?
    let minScore: Double?
    let requiredKeywords: [String]
    let excludedKeywords: [String]
    /// `instant`, `hourly_digest`, `daily_digest` or `manual` (`AlertFrequency`).
    let alertFrequency: String
    /// `score_desc`, `newest`, `price_asc`, `price_desc` or `sqm_desc`. Left out, the server uses `score_desc`.
    var sortBy: String? = nil
    /// Left out, a create uses `in_app` and a PATCH keeps the stored channels.
    var alertChannels: [String]? = nil
}
