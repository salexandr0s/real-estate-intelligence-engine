import Foundation

struct APIOutreachThreadSummaryResponse: Codable, Sendable {
    let id: Int
    let listingId: Int
    let mailboxAccountId: Int
    let contactName: String?
    let contactCompany: String?
    let contactEmail: String
    let contactPhone: String?
    let workflowState: String
    let unreadInboundCount: Int
    let nextActionAt: String?
    let lastInboundAt: String?
    let lastOutboundAt: String?
    let updatedAt: String

    func toDomain() -> OutreachThreadSummary {
        OutreachThreadSummary(
            id: id,
            listingId: listingId,
            mailboxAccountId: mailboxAccountId,
            contactName: contactName,
            contactCompany: contactCompany,
            contactEmail: contactEmail,
            contactPhone: contactPhone,
            workflowState: workflowState,
            unreadInboundCount: unreadInboundCount,
            nextActionAt: nextActionAt.flatMap(Date.fromISO),
            lastInboundAt: lastInboundAt.flatMap(Date.fromISO),
            lastOutboundAt: lastOutboundAt.flatMap(Date.fromISO),
            updatedAt: Date.fromISO(updatedAt)
        )
    }
}
