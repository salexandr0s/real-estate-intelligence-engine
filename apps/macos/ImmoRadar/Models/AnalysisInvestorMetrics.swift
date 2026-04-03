import Foundation

struct AnalysisInvestorMetrics: Codable, Sendable {
    let grossYield: GrossYield
    let priceToRent: Double?
    let sensitivityBands: SensitivityBands

    struct GrossYield: Codable, Sendable {
        let value: Double?
        let assumptions: [String]
    }

    struct SensitivityBands: Codable, Sendable {
        let low: Double?
        let base: Double?
        let high: Double?
    }
}
