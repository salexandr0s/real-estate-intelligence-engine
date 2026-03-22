import Foundation

/// Cross-source cluster showing the same property listed on multiple platforms.
struct ListingCluster: Codable, Sendable {
    let clusterId: Int
    let fingerprint: String
    let listingCount: Int
    let priceSpreadPct: Double?
    let members: [ClusterMember]
}

struct ClusterMember: Identifiable, Codable, Sendable {
    var id: Int { listingId }
    let listingId: Int
    let sourceCode: String
    let sourceName: String
    let title: String
    let listPriceEur: Double?
    let pricePerSqmEur: Double?
    let currentScore: Double?
    let canonicalUrl: String
    let firstSeenAt: String
}
