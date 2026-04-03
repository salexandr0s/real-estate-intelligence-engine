import Foundation

struct AnalysisLocationContext: Codable, Sendable {
    let districtNo: Int?
    let districtName: String?
    let nearestTransit: String?
    let nearestTransitDistanceM: Double?
    let parksNearby: Int
    let schoolsNearby: Int
}
