import Foundation

struct APIOutreachMessageResponse: Codable, Sendable {
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
    let occurredAt: String
    let errorMessage: String?
    let attachments: [APIOutreachAttachmentResponse]

    func toDomain() -> OutreachMessage {
        OutreachMessage(
            id: id,
            direction: direction,
            messageKind: messageKind,
            deliveryStatus: deliveryStatus,
            subject: subject,
            bodyText: bodyText,
            bodyHtml: bodyHtml,
            fromEmail: fromEmail,
            toEmail: toEmail,
            matchStrategy: matchStrategy,
            occurredAt: Date.fromISO(occurredAt),
            errorMessage: errorMessage,
            attachments: attachments.map {
                OutreachAttachment(documentId: $0.documentId, label: $0.label, status: $0.status)
            }
        )
    }
}
