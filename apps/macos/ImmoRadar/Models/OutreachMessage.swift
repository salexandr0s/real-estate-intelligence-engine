import Foundation

struct OutreachMessage: Identifiable, Codable, Hashable, Sendable {
    let id: Int
    let direction: String
    let messageKind: String
    let deliveryStatus: String
    let subject: String
    let bodyText: String?
    let bodyHtml: String?
    let fromEmail: String?
    let toEmail: String?
    let matchStrategy: String
    let occurredAt: Date?
    let errorMessage: String?
    let attachments: [OutreachAttachment]
}
