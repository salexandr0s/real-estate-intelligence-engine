import Foundation

// MARK: - Source DTOs

struct APISourceResponse: Codable {
    let id: Int
    let code: String
    let name: String
    let isActive: Bool
    let healthStatus: String
    let lastSuccessfulRun: String?
    let lastSuccessfulRunAt: String?
    let crawlIntervalMinutes: Int
    let lastErrorSummary: String?
    let totalListingsIngested: Int?
    let successRatePct: Double?
    let lifecycleSummary: APISourceLifecycleSummaryResponse?
}

struct APISourceLifecycleSummaryResponse: Codable {
    let explicitDead24h: Int
    let explicitDead7d: Int
    let staleExpired24h: Int
    let staleExpired7d: Int
    let lastExplicitDeadAt: String?
    let lastStaleExpiredAt: String?
}
