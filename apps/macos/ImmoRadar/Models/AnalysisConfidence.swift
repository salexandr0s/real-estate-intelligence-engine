import Foundation

struct AnalysisConfidence: Codable, Sendable {
    let level: String
    let degradationReasons: [String]
}
