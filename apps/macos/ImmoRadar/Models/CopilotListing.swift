import Foundation

/// Listing data returned by the copilot API (snake_case JSON mapped to camelCase Swift).
struct CopilotListing: Identifiable, Codable, Hashable {
    let id: Int
    let title: String
    let districtNo: Int?
    let districtName: String?
    let priceEur: Int?
    let areaSqm: Double?
    let rooms: Double?
    let pricePerSqmEur: Double?
    let score: Double?
    let canonicalUrl: String?
    let sourceCode: String?
    let priceTrendPct: Double?
}
