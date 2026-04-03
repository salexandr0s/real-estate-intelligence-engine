import Foundation

/// A single message in the copilot conversation.
struct CopilotMessage: Identifiable, Codable {
    let id: UUID
    let role: MessageRole
    var contentBlocks: [ContentBlock]
    let timestamp: Date
    var isStreaming: Bool

    init(
        id: UUID = UUID(),
        role: MessageRole,
        contentBlocks: [ContentBlock],
        timestamp: Date = .now,
        isStreaming: Bool = false
    ) {
        self.id = id
        self.role = role
        self.contentBlocks = contentBlocks
        self.timestamp = timestamp
        self.isStreaming = isStreaming
    }

    enum MessageRole: String, Codable {
        case user
        case assistant
    }
}
