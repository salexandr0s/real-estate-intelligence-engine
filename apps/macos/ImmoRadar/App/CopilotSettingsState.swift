import Foundation

@MainActor @Observable
final class CopilotSettingsState {
    private enum SecretKey: String, CaseIterable {
        case anthropic = "anthropicApiKey"
        case openAI = "openaiApiKey"

        init(_ provider: CopilotProvider) {
            switch provider {
            case .anthropic: self = .anthropic
            case .openai: self = .openAI
            }
        }
    }

    /// `known` after a read or a save, so the key in memory matches the stored one. `unreadable`
    /// after the Keychain refused a read of a key not known yet. No entry means not read yet.
    private enum KeyState {
        case known
        case unreadable
    }

    private let secretStore: any SecretStore

    /// Observed, so the Copilot view can tell "no key stored" from "not read yet".
    private var keyStates: [SecretKey: KeyState] = [:]

    /// Keys read with user interaction allowed. A Copilot message lets the Keychain prompt for its
    /// key only once, so a refused prompt doesn't come back with every message.
    @ObservationIgnored
    private var keysReadInteractively: Set<SecretKey> = []

    var settingsErrorMessage: String?

    var copilotProvider: CopilotProvider {
        didSet { UserDefaults.standard.set(copilotProvider.rawValue, forKey: "copilotProvider") }
    }

    /// Change these through `applySettings`, which saves them.
    private(set) var anthropicApiKey: String = ""
    private(set) var openaiApiKey: String = ""

    var copilotModel: String {
        didSet { UserDefaults.standard.set(copilotModel, forKey: "copilotModel") }
    }

    /// Whether a key is stored for the selected provider, or nil until that key has been read.
    var hasAPIKeyForActiveProvider: Bool? {
        let key = SecretKey(copilotProvider)
        guard keyStates[key] == .known else { return nil }
        return !value(of: key).isEmpty
    }

    init(secretStore: any SecretStore = KeychainStore.api) {
        self.secretStore = secretStore
        // Older builds could save "claudeSubscription", which now reads as Anthropic.
        let rawProvider = UserDefaults.standard.string(forKey: "copilotProvider") ?? ""
        self.copilotProvider = CopilotProvider(rawValue: rawProvider) ?? .anthropic
        self.copilotModel = UserDefaults.standard.string(forKey: "copilotModel") ?? ""
    }

    /// True when the Keychain refused to read this provider's stored key.
    func isKeyUnreadable(for provider: CopilotProvider) -> Bool {
        keyStates[SecretKey(provider)] == .unreadable
    }

    func clearSettingsError() {
        settingsErrorMessage = nil
    }

    /// Reads the keys not read yet. A key already read matches the stored one.
    func loadCopilotSecretsIfNeeded(allowUserInteraction: Bool) {
        for key in SecretKey.allCases {
            load(key, allowUserInteraction: allowUserInteraction)
        }
    }

    /// Saves the Copilot settings. A nil key leaves the stored key as it is, and an empty one
    /// deletes it.
    @discardableResult
    func applySettings(
        provider: CopilotProvider,
        anthropicKey: String?,
        openAIKey: String?,
        model: String
    ) async -> Bool {
        clearSettingsError()

        if let anthropicKey {
            guard save(anthropicKey, as: .anthropic, label: "Anthropic API key") else { return false }
        }
        if let openAIKey {
            guard save(openAIKey, as: .openAI, label: "OpenAI API key") else { return false }
        }

        copilotProvider = provider
        copilotModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        return true
    }

    /// The key Copilot sends as `X-Copilot-Api-Key` for the selected provider. Only that key is
    /// read, and only its first read may prompt.
    func activeAPIKey() -> String {
        let key = SecretKey(copilotProvider)
        load(key, allowUserInteraction: !keysReadInteractively.contains(key))
        return value(of: key)
    }

    func cleanupStoredSecrets() {
        for key in SecretKey.allCases {
            secretStore.deleteIfEmpty(key: key.rawValue, allowUserInteraction: true)
        }
    }

    func runSilentStaleSecretsCleanupIfNeeded(versionKey: String) {
        guard !UserDefaults.standard.bool(forKey: versionKey) else { return }
        for key in SecretKey.allCases {
            secretStore.deleteIfEmpty(key: key.rawValue, allowUserInteraction: false)
        }
        UserDefaults.standard.set(true, forKey: versionKey)
    }

    /// Reads a key not read yet. After a refused read the key stays unread, and a later call
    /// tries again.
    private func load(_ key: SecretKey, allowUserInteraction: Bool) {
        guard keyStates[key] != .known else { return }
        if allowUserInteraction {
            keysReadInteractively.insert(key)
        }
        switch secretStore.load(key: key.rawValue, allowUserInteraction: allowUserInteraction) {
        case .value(let stored):
            setValue(stored, of: key)
            keyStates[key] = .known
        case .unreadable:
            keyStates[key] = .unreadable
        }
    }

    private func save(_ rawValue: String, as key: SecretKey, label: String) -> Bool {
        let newValue = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try secretStore.save(key: key.rawValue, value: newValue)
        } catch {
            settingsErrorMessage = "Couldn’t save the \(label). \(error.localizedDescription)"
            return false
        }
        setValue(newValue, of: key)
        keyStates[key] = .known
        return true
    }

    private func value(of key: SecretKey) -> String {
        switch key {
        case .anthropic: anthropicApiKey
        case .openAI: openaiApiKey
        }
    }

    private func setValue(_ newValue: String, of key: SecretKey) {
        switch key {
        case .anthropic: anthropicApiKey = newValue
        case .openAI: openaiApiKey = newValue
        }
    }
}
