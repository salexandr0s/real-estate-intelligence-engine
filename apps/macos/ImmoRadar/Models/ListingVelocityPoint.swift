import Foundation

/// Daily new-listing count for sparkline charts (from GET /v1/dashboard/velocity).
struct ListingVelocityPoint: Identifiable, Codable, Sendable {
    /// A Vienna calendar day, "YYYY-MM-DD".
    let day: String
    let count: Int
    var id: String { day }

    /// The day as the start of that calendar day here, so a chart shows it on the same day.
    var parsedDay: Date? {
        Date.fromCalendarDay(day)
    }
}
