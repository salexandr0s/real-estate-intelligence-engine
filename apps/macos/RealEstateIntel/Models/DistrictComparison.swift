import Foundation

/// Per-district aggregate stats (from GET /v1/analytics/district-comparison).
struct DistrictComparison: Identifiable, Codable, Sendable {
    let districtNo: Int
    let listingCount: Int
    let avgPricePerSqm: Double
    let minPricePerSqm: Double
    let maxPricePerSqm: Double
    let avgScore: Double?
    var id: Int { districtNo }
}
