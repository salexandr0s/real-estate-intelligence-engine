import Foundation

struct ProximityNearestItem: Codable, Identifiable {
    let category: POICategory
    let label: String
    let name: String
    let distanceM: Int
    let walkMinutes: Int
    let rank: Int
    let coordinate: CopilotCoordinate?

    var id: String { "\(category.rawValue)-\(rank)" }
}
