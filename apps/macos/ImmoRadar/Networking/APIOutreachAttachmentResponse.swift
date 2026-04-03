import Foundation

struct APIOutreachAttachmentResponse: Codable, Sendable {
    let documentId: Int
    let label: String?
    let status: String
}
