import Foundation

/// A single scrape run with execution stats.
struct ScrapeRun: Identifiable, Codable, Sendable {
    let id: Int
    let sourceCode: String
    let status: String
    let scope: String
    let triggerType: String
    let pagesFetched: Int
    let listingsDiscovered: Int
    let http2xx: Int
    let http4xx: Int
    let http5xx: Int
    let captchaCount: Int
    let retryCount: Int
    let startedAt: String?
    let finishedAt: String?
    let errorCode: String?
    let errorMessage: String?
    let createdAt: String

    var isSuccess: Bool {
        status == "succeeded" || status == "partial"
    }

    var parsedStartedAt: Date? {
        startedAt.flatMap(Date.fromISO)
    }
}
