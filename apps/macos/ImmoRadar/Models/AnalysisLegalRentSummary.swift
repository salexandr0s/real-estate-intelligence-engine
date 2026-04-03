import Foundation

struct AnalysisLegalRentSummary: Codable, Sendable {
    let status: String
    let regimeCandidate: String?
    let confidence: String
    let strongSignals: [LegalRentSignal]
    let weakSignals: [LegalRentSignal]
    let missingFacts: [String]
    let reviewRequired: Bool
    let indicativeBandLow: Double?
    let indicativeBandHigh: Double?
    let disclaimer: String

    struct LegalRentSignal: Codable, Sendable {
        let signal: String
        let source: String
    }
}
