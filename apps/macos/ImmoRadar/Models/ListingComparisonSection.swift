import Foundation

struct ListingComparisonSection: Codable, Identifiable {
    let title: String
    let metrics: [ListingComparisonMetric]

    var id: String { title }
}
