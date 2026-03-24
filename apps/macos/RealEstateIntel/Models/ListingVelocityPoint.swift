import Foundation

/// Daily new-listing count for sparkline charts (from GET /v1/dashboard/velocity).
struct ListingVelocityPoint: Identifiable, Codable, Sendable {
    let day: String
    let count: Int
    var id: String { day }
}
