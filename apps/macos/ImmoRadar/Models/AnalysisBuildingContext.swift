import Foundation

struct AnalysisBuildingContext: Codable, Sendable {
    let buildingFactId: Int
    let matchConfidence: String
    let yearBuilt: Int?
    let typology: String?
    let unitCount: Int?
    let source: String
    let sourceUpdatedAt: String?
}
