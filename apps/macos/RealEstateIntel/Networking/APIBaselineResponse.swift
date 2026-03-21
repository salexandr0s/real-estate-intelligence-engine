import Foundation

// MARK: - Baseline DTOs

struct APIBaselineResponse: Codable {
    let city: String
    let districtNo: Int?
    let operationType: String
    let propertyType: String
    let areaBucket: String
    let roomBucket: String
    let sampleSize: Int
    let medianPpsqmEur: Double
    let p25PpsqmEur: Double?
    let p75PpsqmEur: Double?
    let stddevPpsqmEur: Double?
    let baselineDate: String?
}
