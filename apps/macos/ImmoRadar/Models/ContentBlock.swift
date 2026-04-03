import Foundation

/// Rich content block rendered within a copilot message.
/// Wraps content with a stable UUID for SwiftUI identity.
struct ContentBlock: Identifiable, Codable {
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
