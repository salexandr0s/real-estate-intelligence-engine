import Foundation

/// Events emitted by the copilot SSE stream.
enum CopilotStreamEvent {
    case textDelta(String)
    case toolUse(name: String)
    case contentBlock(ContentBlock)
    case done
    case error(String)
}
