import Foundation

struct AnalysisMarketContext: Codable, Sendable {
    let fallbackLevel: String
    let sampleSize: Int
    let medianPpsqm: Int?
    let p25Ppsqm: Int?
    let p75Ppsqm: Int?
    let confidence: String
}
