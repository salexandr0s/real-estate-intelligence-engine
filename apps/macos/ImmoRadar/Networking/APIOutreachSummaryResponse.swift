import Foundation

struct APIOutreachSummaryResponse: Codable, Sendable {
    let threadId: Int
    let workflowState: String
    let unreadInboundCount: Int
    let nextActionAt: String?
    let lastInboundAt: String?
    let lastOutboundAt: String?

    func toDomain() -> OutreachSummary {
        OutreachSummary(
            threadId: threadId,
            workflowState: workflowState,
            unreadInboundCount: unreadInboundCount,
            nextActionAt: nextActionAt.flatMap(Date.fromISO),
            lastInboundAt: lastInboundAt.flatMap(Date.fromISO),
            lastOutboundAt: lastOutboundAt.flatMap(Date.fromISO)
        )
    }
}
