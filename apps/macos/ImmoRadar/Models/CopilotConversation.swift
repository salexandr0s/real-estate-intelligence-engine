import Foundation

struct CopilotConversation: Identifiable, Codable {
    let id: UUID
    var title: String
    let createdAt: Date
    var updatedAt: Date
    var messages: [CopilotMessage]

    init(
        id: UUID = UUID(),
        title: String,
        createdAt: Date = .now,
        updatedAt: Date = .now,
        messages: [CopilotMessage] = []
    ) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.messages = messages
    }

    var summary: CopilotConversationSummary {
        CopilotConversationSummary(
            id: id,
            title: title,
            preview: previewText,
            updatedAt: updatedAt,
            messageCount: messages.count
        )
    }

    private var previewText: String {
        for message in messages.reversed() {
            if let text = message.contentBlocks.compactMap({ block -> String? in
                if case .text(let value) = block.content {
                    return value.trimmingCharacters(in: .whitespacesAndNewlines)
                }
                return nil
            }).first,
               !text.isEmpty {
                return text
            }
        }
        return "No saved messages"
    }
}
