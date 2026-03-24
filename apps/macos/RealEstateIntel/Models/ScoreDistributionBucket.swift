import Foundation

/// Score histogram bucket (from GET /v1/analytics/score-distribution).
struct ScoreDistributionBucket: Identifiable, Codable, Sendable {
    let bucket: String
    let count: Int
    var id: String { bucket }
}
