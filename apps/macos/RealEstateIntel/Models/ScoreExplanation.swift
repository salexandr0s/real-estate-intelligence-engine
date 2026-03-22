import Foundation

struct ScoreExplanation: Codable, Hashable {
    let scoreVersion: Int
    let overallScore: Double
    let districtPriceScore: Double
    let undervaluationScore: Double
    let keywordSignalScore: Double
    let timeOnMarketScore: Double
    let confidenceScore: Double
    let locationScore: Double?
    let districtBaselinePpsqmEur: Double
    let bucketBaselinePpsqmEur: Double
    let discountToDistrictPct: Double
    let discountToBucketPct: Double
    let matchedPositiveKeywords: [String]
    let matchedNegativeKeywords: [String]
}
