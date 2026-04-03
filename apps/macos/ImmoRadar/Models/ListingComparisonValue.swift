import Foundation

struct ListingComparisonValue: Codable, Identifiable {
    let listingId: Int
    let value: String?
    let emphasis: Emphasis?

    var id: Int { listingId }

    enum Emphasis: String, Codable {
        case best
        case weakest
        case neutral
    }
}
