import Foundation

struct CrossSourceComparisonMember: Codable, Identifiable {
    let listingId: Int
    let sourceCode: String
    let sourceName: String
    let title: String
    let listPriceEur: Double?
    let pricePerSqmEur: Double?
    let currentScore: Double?
    let canonicalUrl: String
    let firstSeenAt: String
    let isSubject: Bool

    var id: Int { listingId }
}
