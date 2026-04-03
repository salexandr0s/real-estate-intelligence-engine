import Foundation

struct ListingComparisonMetric: Codable, Identifiable {
    let label: String
    let values: [ListingComparisonValue]

    var id: String { label }
}
