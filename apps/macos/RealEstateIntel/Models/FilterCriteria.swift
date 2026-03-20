import Foundation

struct FilterCriteria: Codable, Hashable {
    var operationType: OperationType?
    var propertyTypes: [PropertyType]
    var districts: [Int]
    var minPriceEur: Int?
    var maxPriceEur: Int?
    var minAreaSqm: Double?
    var maxAreaSqm: Double?
    var minRooms: Int?
    var maxRooms: Int?
    var minScore: Double?
    var requiredKeywords: [String]
    var excludedKeywords: [String]
    var sortBy: String?
}
