import Foundation

@MainActor @Observable
final class CopilotSettingsState {
    @ObservationIgnored
    private var didLoadCopilotSecrets = false

    @ObservationIgnored
    private var didLoadCopilotSecretsWithInteraction = false

    @ObservationIgnored
    private var didLoadClaudeSubscription = false

    var settingsErrorMessage: String?

    var copilotProvider: CopilotProvider = {
        let raw = UserDefaults.standard.string(forKey: "copilotProvider") ?? "anthropic"
        return CopilotProvider(rawValue: raw) ?? .anthropic
    }() {
        didSet { UserDefaults.standard.set(copilotProvider.rawValue, forKey: "copilotProvider") }
    }

    var anthropicApiKey: String = ""
    var openaiApiKey: String = ""

    var copilotModel: String = UserDefaults.standard.string(forKey: "copilotModel") ?? "" {
        didSet { UserDefaults.standard.set(copilotModel, forKey: "copilotModel") }
    }

    var claudeSubscriptionAvailable: Bool = false
    var claudeSubscriptionType: String?

    func clearSettingsError() {
        settingsErrorMessage = nil
    }

    func loadCopilotSecretsIfNeeded(allowUserInteraction: Bool) {
        if didLoadCopilotSecrets && (!allowUserInteraction || didLoadCopilotSecretsWithInteraction) {
            return
        }

        anthropicApiKey = KeychainHelper.get(
            key: "anthropicApiKey",
            allowUserInteraction: allowUserInteraction
        ) ?? ""
        openaiApiKey = KeychainHelper.get(
            key: "openaiApiKey",
            allowUserInteraction: allowUserInteraction
        ) ?? ""
        if allowUserInteraction {
            if anthropicApiKey.isEmpty {
                _ = KeychainHelper.delete(key: "anthropicApiKey")
            }
            if openaiApiKey.isEmpty {
                _ = KeychainHelper.delete(key: "openaiApiKey")
            }
        }
        didLoadCopilotSecrets = true
        didLoadCopilotSecretsWithInteraction = allowUserInteraction
    }

    func loadClaudeSubscriptionIfNeeded() {
        guard !didLoadClaudeSubscription else { return }
        refreshClaudeSubscription()
    }

    func refreshClaudeSubscription() {
        let status = ClaudeAuthHelper.loadSubscriptionStatus()
        claudeSubscriptionAvailable = status.isAvailable
        claudeSubscriptionType = status.subscriptionType
        didLoadClaudeSubscription = true
    }

    @discardableResult
    func applySettings(
        provider: CopilotProvider,
        anthropicKey: String,
        openAIKey: String,
        model: String
    ) async -> Bool {
        clearSettingsError()

        let normalizedAnthropicKey = anthropicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedOpenAIKey = openAIKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)

        switch provider {
        case .anthropic:
            guard persistSecret(
                value: normalizedAnthropicKey,
                key: "anthropicApiKey",
                label: "Anthropic API key"
            ) else {
                return false
            }
            anthropicApiKey = normalizedAnthropicKey
            didLoadCopilotSecrets = true
            didLoadCopilotSecretsWithInteraction = true
        case .openai:
            guard persistSecret(
                value: normalizedOpenAIKey,
                key: "openaiApiKey",
                label: "OpenAI API key"
            ) else {
                return false
            }
            openaiApiKey = normalizedOpenAIKey
            didLoadCopilotSecrets = true
            didLoadCopilotSecretsWithInteraction = true
        case .claudeSubscription:
            break
        }

        copilotProvider = provider
        copilotModel = normalizedModel
        return true
    }

    func activeAPIKey() -> String {
        switch copilotProvider {
        case .anthropic:
            loadCopilotSecretsIfNeeded(allowUserInteraction: true)
            return anthropicApiKey
        case .openai:
            loadCopilotSecretsIfNeeded(allowUserInteraction: true)
            return openaiApiKey
        case .claudeSubscription:
            return ClaudeAuthHelper.loadOAuthToken() ?? ""
        }
    }

    func cleanupStoredSecrets() {
        cleanupIfEmpty(key: "anthropicApiKey", allowUserInteraction: true)
        cleanupIfEmpty(key: "openaiApiKey", allowUserInteraction: true)
    }

    func runSilentStaleSecretsCleanupIfNeeded(versionKey: String) {
        guard !UserDefaults.standard.bool(forKey: versionKey) else { return }
        cleanupIfEmpty(key: "anthropicApiKey", allowUserInteraction: false)
        cleanupIfEmpty(key: "openaiApiKey", allowUserInteraction: false)
        UserDefaults.standard.set(true, forKey: versionKey)
    }

    @discardableResult
    private func persistSecret(value: String, key: String, label: String) -> Bool {
        do {
            if value.isEmpty {
                _ = KeychainHelper.delete(key: key)
            } else {
                try KeychainHelper.set(key: key, value: value)
            }
            settingsErrorMessage = nil
            return true
        } catch {
            settingsErrorMessage = "Couldn’t save \(label). \(error.localizedDescription)"
            return false
        }
    }

    private func cleanupIfEmpty(key: String, allowUserInteraction: Bool) {
        guard let value = KeychainHelper.get(
            key: key,
            allowUserInteraction: allowUserInteraction
        ) else {
            return
        }

        guard value.isEmpty else { return }
        _ = KeychainHelper.delete(key: key)
    }
}
