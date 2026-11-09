import Foundation

enum CopilotProvider: String, CaseIterable, Identifiable {
    case anthropic
    case openai

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .anthropic: "Anthropic"
        case .openai: "OpenAI"
        }
    }

    /// The `provider` value the chat route takes.
    var apiProvider: String { rawValue }

    /// The model the server uses when none is set. `COPILOT_MODEL` on the server can change it.
    var defaultModel: String {
        switch self {
        case .anthropic: "claude-sonnet-5-5"
        case .openai: "gpt-4o"
        }
    }
}
