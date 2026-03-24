import Foundation

// MARK: - Source DTOs

struct APISourceResponse: Codable {
    let id: Int
    let code: String
    let name: String
    let isActive: Bool
    let healthStatus: String
    let lastSuccessfulRun: String?
    let crawlIntervalMinutes: Int
    let lastErrorSummary: String?
    let totalListingsIngested: Int?
    let successRatePct: Double?
}
