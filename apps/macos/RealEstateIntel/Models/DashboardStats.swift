import Foundation

/// Server-side dashboard stats returned by GET /v1/dashboard/stats.
struct DashboardStats: Codable, Sendable {
    let totalActive: Int
    let newToday: Int
    let newThisWeek: Int?
    let highScore70: Int
    let avgScore: Double?
}
