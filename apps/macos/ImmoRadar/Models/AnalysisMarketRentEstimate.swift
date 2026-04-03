import Foundation

struct AnalysisMarketRentEstimate: Codable, Sendable {
    let estimateLow: Double?
    let estimateMid: Double?
    let estimateHigh: Double?
    let eurPerSqmMid: Double?
    let fallbackLevel: String
    let sampleSize: Int
    let confidence: String
}
