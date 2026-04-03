import Foundation

struct ProximityCountItem: Codable, Identifiable {
    let category: POICategory
    let label: String
    let withinMeters: Int
    let count: Int

    var id: String { "\(category.rawValue)-\(withinMeters)" }
}
