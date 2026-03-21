import Foundation

/// Market baseline data from the analytics API.
/// Represents aggregated pricing statistics per district/bucket.
struct MarketBaseline: Identifiable, Codable, Hashable {
    var id: String {
        "\(city)-\(districtNo ?? 0)-\(operationType)-\(propertyType)-\(areaBucket)-\(roomBucket)"
    }

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
    let baselineDate: Date
}

// MARK: - Mock Data

extension MarketBaseline {
    static let samples: [MarketBaseline] = [
        MarketBaseline(
            city: "Wien", districtNo: 1, operationType: "sale", propertyType: "apartment",
            areaBucket: "50-80", roomBucket: "2-3", sampleSize: 42,
            medianPpsqmEur: 8200, p25PpsqmEur: 7100, p75PpsqmEur: 9800,
            stddevPpsqmEur: 1400, baselineDate: Date.now
        ),
        MarketBaseline(
            city: "Wien", districtNo: 2, operationType: "sale", propertyType: "apartment",
            areaBucket: "50-80", roomBucket: "2-3", sampleSize: 87,
            medianPpsqmEur: 5800, p25PpsqmEur: 4900, p75PpsqmEur: 6500,
            stddevPpsqmEur: 920, baselineDate: Date.now
        ),
        MarketBaseline(
            city: "Wien", districtNo: 3, operationType: "sale", propertyType: "apartment",
            areaBucket: "50-80", roomBucket: "2-3", sampleSize: 65,
            medianPpsqmEur: 5400, p25PpsqmEur: 4600, p75PpsqmEur: 6200,
            stddevPpsqmEur: 850, baselineDate: Date.now
        ),
        MarketBaseline(
            city: "Wien", districtNo: 5, operationType: "sale", propertyType: "apartment",
            areaBucket: "50-80", roomBucket: "2-3", sampleSize: 53,
            medianPpsqmEur: 4800, p25PpsqmEur: 4100, p75PpsqmEur: 5500,
            stddevPpsqmEur: 780, baselineDate: Date.now
        ),
        MarketBaseline(
            city: "Wien", districtNo: 7, operationType: "sale", propertyType: "apartment",
            areaBucket: "30-50", roomBucket: "1-2", sampleSize: 38,
            medianPpsqmEur: 5600, p25PpsqmEur: 4800, p75PpsqmEur: 6400,
            stddevPpsqmEur: 900, baselineDate: Date.now
        ),
        MarketBaseline(
            city: "Wien", districtNo: 10, operationType: "sale", propertyType: "apartment",
            areaBucket: "50-80", roomBucket: "2-3", sampleSize: 112,
            medianPpsqmEur: 3800, p25PpsqmEur: 3200, p75PpsqmEur: 4300,
            stddevPpsqmEur: 620, baselineDate: Date.now
        ),
        MarketBaseline(
            city: "Wien", districtNo: 21, operationType: "sale", propertyType: "apartment",
            areaBucket: "50-80", roomBucket: "2-3", sampleSize: 76,
            medianPpsqmEur: 3400, p25PpsqmEur: 2900, p75PpsqmEur: 4000,
            stddevPpsqmEur: 580, baselineDate: Date.now
        ),
        MarketBaseline(
            city: "Wien", districtNo: 22, operationType: "rent", propertyType: "apartment",
            areaBucket: "50-80", roomBucket: "2-3", sampleSize: 95,
            medianPpsqmEur: 14, p25PpsqmEur: 11, p75PpsqmEur: 17,
            stddevPpsqmEur: 3.5, baselineDate: Date.now
        ),
    ]
}
