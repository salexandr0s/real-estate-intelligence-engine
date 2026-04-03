import Foundation

struct MailboxAccount: Identifiable, Codable, Hashable, Sendable {
    let id: Int
    let email: String
    let displayName: String?
    let syncStatus: String
    let pollIntervalSeconds: Int
    let lastSuccessfulSyncAt: Date?
    let lastErrorMessage: String?
}
