import Foundation

struct ScoreBreakdownData: Codable {
    let listingId: Int
    let overall: Double
    let components: [ScoreComponent]
    let discountToDistrictPct: Double?
    let discountToBucketPct: Double?
    let positiveKeywords: [String]?
    let negativeKeywords: [String]?
}
