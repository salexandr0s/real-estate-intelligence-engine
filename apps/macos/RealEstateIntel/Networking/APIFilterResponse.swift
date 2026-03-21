import Foundation

// MARK: - Filter DTOs

struct APIFilterResponse: Codable {
    let id: Int
    let name: String
    let filterKind: String
    let isActive: Bool
    let operationType: String?
    let propertyTypes: [String]?
    let districts: [Int]?
    let minPriceEur: Int?
    let maxPriceEur: Int?
    let minAreaSqm: Double?
    let maxAreaSqm: Double?
    let minRooms: Int?
    let maxRooms: Int?
    let minScore: Double?
    let requiredKeywords: [String]?
    let excludedKeywords: [String]?
    let sortBy: String?
    let alertFrequency: String?
    let createdAt: String
    let updatedAt: String
    let matchCount: Int?
}

struct APICreateFilterRequest: Codable {
    let name: String
    let filterKind: String
    let operationType: String?
    let propertyTypes: [String]
    let districts: [Int]
    let maxPriceEur: Int?
    let minAreaSqm: Double?
    let minScore: Double?
    let requiredKeywords: [String]
    let excludedKeywords: [String]
    let alertFrequency: String
}
