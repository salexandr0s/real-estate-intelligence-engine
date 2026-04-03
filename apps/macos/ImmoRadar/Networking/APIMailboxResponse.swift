import Foundation

struct APIMailboxResponse: Codable, Sendable {
    let id: Int
    let email: String
    let displayName: String?
    let syncStatus: String
    let pollIntervalSeconds: Int
    let lastSuccessfulSyncAt: String?
    let lastErrorMessage: String?

    func toDomain() -> MailboxAccount {
        MailboxAccount(
            id: id,
            email: email,
            displayName: displayName,
            syncStatus: syncStatus,
            pollIntervalSeconds: pollIntervalSeconds,
            lastSuccessfulSyncAt: lastSuccessfulSyncAt.flatMap(Date.fromISO),
            lastErrorMessage: lastErrorMessage
        )
    }
}
