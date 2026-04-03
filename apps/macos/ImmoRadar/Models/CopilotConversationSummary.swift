import Foundation

struct CopilotConversationSummary: Identifiable, Hashable {
    let id: UUID
    let title: String
    let preview: String
    let updatedAt: Date
    let messageCount: Int
}
