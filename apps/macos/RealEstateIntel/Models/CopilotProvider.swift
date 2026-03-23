import Foundation

enum CopilotProvider: String, CaseIterable, Identifiable {
    case anthropic
    case openai
    case claudeSubscription

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .anthropic: "Anthropic API Key"
        case .openai: "OpenAI"
        case .claudeSubscription: "Claude Subscription"
        }
    }

    var apiProvider: String {
        switch self {
        case .anthropic, .claudeSubscription: "anthropic"
        case .openai: "openai"
        }
    }
}
