import Foundation

struct OutreachSummary: Codable, Hashable, Sendable {
    let threadId: Int
    let workflowState: String
    let unreadInboundCount: Int
    let nextActionAt: Date?
    let lastInboundAt: Date?
    let lastOutboundAt: Date?
}
