import Foundation

/// Scraping source configuration and health status.
/// Maps to the `/v1/sources` API resource.
struct Source: Identifiable, Codable, Hashable {
    let id: Int
    let code: String
    let name: String
    var isActive: Bool
    let healthStatus: SourceHealthStatus
    let lastSuccessfulRun: Date?
    var crawlIntervalMinutes: Int
    let lastErrorSummary: String?
    let totalListingsIngested: Int
    let successRatePct: Double
}

// MARK: - Mock Data

extension Source {
    static let samples: [Source] = [
        Source(
            id: 1,
            code: "willhaben",
            name: "willhaben.at",
            isActive: true,
            healthStatus: .healthy,
            lastSuccessfulRun: Calendar.current.date(byAdding: .minute, value: -8, to: .now) ?? .now,
            crawlIntervalMinutes: 15,
            lastErrorSummary: nil,
            totalListingsIngested: 12_847,
            successRatePct: 99.2
        ),
        Source(
            id: 2,
            code: "immoscout",
            name: "ImmobilienScout24.at",
            isActive: true,
            healthStatus: .healthy,
            lastSuccessfulRun: Calendar.current.date(byAdding: .minute, value: -12, to: .now) ?? .now,
            crawlIntervalMinutes: 15,
            lastErrorSummary: nil,
            totalListingsIngested: 8_432,
            successRatePct: 98.7
        ),
        Source(
            id: 3,
            code: "immoworld",
            name: "Immo-World.at",
            isActive: true,
            healthStatus: .degraded,
            lastSuccessfulRun: Calendar.current.date(byAdding: .hour, value: -2, to: .now) ?? .now,
            crawlIntervalMinutes: 30,
            lastErrorSummary: "Elevated 429 rate (23%) in last 30 min",
            totalListingsIngested: 3_291,
            successRatePct: 87.4
        ),
        Source(
            id: 4,
            code: "derstandard",
            name: "derStandard.at/Immobilien",
            isActive: false,
            healthStatus: .disabled,
            lastSuccessfulRun: Calendar.current.date(byAdding: .day, value: -5, to: .now) ?? .now,
            crawlIntervalMinutes: 60,
            lastErrorSummary: "Source adapter pending DOM update",
            totalListingsIngested: 1_104,
            successRatePct: 0.0
        ),
        Source(
            id: 5,
            code: "bazar",
            name: "bazar.at",
            isActive: true,
            healthStatus: .blocked,
            lastSuccessfulRun: Calendar.current.date(byAdding: .hour, value: -18, to: .now) ?? .now,
            crawlIntervalMinutes: 60,
            lastErrorSummary: "CAPTCHA wall detected on discovery pages since 06:12 UTC",
            totalListingsIngested: 2_054,
            successRatePct: 12.3
        ),
    ]
}
