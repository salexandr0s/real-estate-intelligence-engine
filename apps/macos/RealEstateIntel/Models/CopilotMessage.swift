import Foundation

// MARK: - Message

/// A single message in the copilot conversation.
struct CopilotMessage: Identifiable {
    let id: UUID
    let role: MessageRole
    var contentBlocks: [ContentBlock]
    let timestamp: Date
    var isStreaming: Bool

    init(role: MessageRole, contentBlocks: [ContentBlock], isStreaming: Bool = false) {
        self.id = UUID()
        self.role = role
        self.contentBlocks = contentBlocks
        self.timestamp = Date.now
        self.isStreaming = isStreaming
    }

    enum MessageRole: String, Codable {
        case user
        case assistant
    }
}

// MARK: - Content Block

/// Rich content block rendered within a copilot message.
/// Wraps content with a stable UUID for SwiftUI identity.
struct ContentBlock: Identifiable {
    let id: UUID
    let content: ContentBlockType

    init(_ content: ContentBlockType) {
        self.id = UUID()
        self.content = content
    }

    init(id: UUID, content: ContentBlockType) {
        self.id = id
        self.content = content
    }
}

/// The actual content variants for a copilot message block.
enum ContentBlockType {
    case text(String)
    case listingCards([CopilotListing])
    case comparisonTable(ComparisonTableData)
    case scoreBreakdown(ScoreBreakdownData)
    case priceHistory(PriceHistoryData)
    case chartData(ChartBlockData)
    case marketStats([StatItem])
    case loading(String)
}
