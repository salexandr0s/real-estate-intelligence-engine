import Foundation

@MainActor @Observable
final class CopilotSettingsState {
    private enum SecretKey {
        static let anthropic = "anthropicApiKey"
        static let openAI = "openaiApiKey"
    }

    private let secretStore: any SecretStore

    /// Observed, so the Copilot view can tell "no key stored" from "not read yet".
    private var didLoadCopilotSecrets = false

    @ObservationIgnored
    private var didLoadCopilotSecretsWithInteraction = false

    var settingsErrorMessage: String?

    var copilotProvider: CopilotProvider {
        didSet { UserDefaults.standard.set(copilotProvider.rawValue, forKey: "copilotProvider") }
    }

    var anthropicApiKey: String = ""
    var openaiApiKey: String = ""

    var copilotModel: String {
        didSet { UserDefaults.standard.set(copilotModel, forKey: "copilotModel") }
    }

    /// Whether a key is stored for the selected provider, or nil until the Keychain has been read.
    var hasAPIKeyForActiveProvider: Bool? {
        guard didLoadCopilotSecrets else { return nil }
        switch copilotProvider {
        case .anthropic: return !anthropicApiKey.isEmpty
        case .openai: return !openaiApiKey.isEmpty
        }
    }

    init(secretStore: any SecretStore = KeychainStore.api) {
        self.secretStore = secretStore
        // Older builds could save "claudeSubscription", which now reads as Anthropic.
        let rawProvider = UserDefaults.standard.string(forKey: "copilotProvider") ?? ""
        self.copilotProvider = CopilotProvider(rawValue: rawProvider) ?? .anthropic
        self.copilotModel = UserDefaults.standard.string(forKey: "copilotModel") ?? ""
    }

    func clearSettingsError() {
        settingsErrorMessage = nil
    }

    func loadCopilotSecretsIfNeeded(allowUserInteraction: Bool) {
        if didLoadCopilotSecrets && (!allowUserInteraction || didLoadCopilotSecretsWithInteraction) {
            return
        }

        let anthropic = secretStore.load(key: SecretKey.anthropic, allowUserInteraction: allowUserInteraction)
        let openAI = secretStore.load(key: SecretKey.openAI, allowUserInteraction: allowUserInteraction)
        if case .value(let key) = anthropic {
            anthropicApiKey = key
        }
        if case .value(let key) = openAI {
            openaiApiKey = key
        }

        // After a failed read the keys in memory stay, and the secrets stay unloaded so a later call reads again.
        guard case .value = anthropic, case .value = openAI else { return }
        didLoadCopilotSecrets = true
        didLoadCopilotSecretsWithInteraction = allowUserInteraction
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
                key: SecretKey.anthropic,
                label: "Anthropic API key"
            ) else {
                return false
            }
            anthropicApiKey = normalizedAnthropicKey
        case .openai:
            guard persistSecret(
                value: normalizedOpenAIKey,
                key: SecretKey.openAI,
                label: "OpenAI API key"
            ) else {
                return false
            }
            openaiApiKey = normalizedOpenAIKey
        }
        didLoadCopilotSecrets = true
        didLoadCopilotSecretsWithInteraction = true

        copilotProvider = provider
        copilotModel = normalizedModel
        return true
    }

    /// The key Copilot sends as `X-Copilot-Api-Key` for the selected provider.
    func activeAPIKey() -> String {
        loadCopilotSecretsIfNeeded(allowUserInteraction: true)
        switch copilotProvider {
        case .anthropic: return anthropicApiKey
        case .openai: return openaiApiKey
        }
    }

    func cleanupStoredSecrets() {
        secretStore.deleteIfEmpty(key: SecretKey.anthropic, allowUserInteraction: true)
        secretStore.deleteIfEmpty(key: SecretKey.openAI, allowUserInteraction: true)
    }

    func runSilentStaleSecretsCleanupIfNeeded(versionKey: String) {
        guard !UserDefaults.standard.bool(forKey: versionKey) else { return }
        secretStore.deleteIfEmpty(key: SecretKey.anthropic, allowUserInteraction: false)
        secretStore.deleteIfEmpty(key: SecretKey.openAI, allowUserInteraction: false)
        UserDefaults.standard.set(true, forKey: versionKey)
    }

    @discardableResult
    private func persistSecret(value: String, key: String, label: String) -> Bool {
        do {
            try secretStore.save(key: key, value: value)
            settingsErrorMessage = nil
            return true
        } catch {
            settingsErrorMessage = "Couldn’t save the \(label). \(error.localizedDescription)"
            return false
        }
    }
}
