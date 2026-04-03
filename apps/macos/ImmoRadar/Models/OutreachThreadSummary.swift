import Foundation

struct OutreachThreadSummary: Identifiable, Codable, Hashable, Sendable {
    let id: Int
    let listingId: Int
    let mailboxAccountId: Int
    let contactName: String?
    let contactCompany: String?
    let contactEmail: String
    let contactPhone: String?
    let workflowState: String
    let unreadInboundCount: Int
    let nextActionAt: Date?
    let lastInboundAt: Date?
    let lastOutboundAt: Date?
    let updatedAt: Date?
}
