import Foundation

struct OutreachAttachment: Identifiable, Codable, Hashable, Sendable {
    let documentId: Int
    let label: String?
    let status: String

    var id: Int { documentId }
}
