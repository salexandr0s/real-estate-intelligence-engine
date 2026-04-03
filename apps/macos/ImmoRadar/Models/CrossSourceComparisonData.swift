import Foundation

struct CrossSourceComparisonData: Codable {
    let subjectListingId: Int
    let clusterId: Int
    let priceSpreadPct: Double?
    let summary: String
    let members: [CrossSourceComparisonMember]
}
