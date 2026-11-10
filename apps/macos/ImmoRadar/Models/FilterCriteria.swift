import Foundation

struct FilterCriteria: Codable, Hashable {
    var operationType: OperationType?
    var propertyTypes: [PropertyType]
    var districts: [Int]
    var minPriceEur: Int?
    var maxPriceEur: Int?
    var minAreaSqm: Double?
    var maxAreaSqm: Double?
    /// Rooms can be fractional (2.5), as the server's NUMERIC(4,1) column allows.
    var minRooms: Double?
    var maxRooms: Double?
    var minScore: Double?
    var requiredKeywords: [String]
    var excludedKeywords: [String]
    var sortBy: String?
}
