import SwiftUI

// MARK: - App State

/// Central observable state for the application.
/// Tracks navigation, connection status, and global counters.
@MainActor @Observable
final class AppState {

    // MARK: - Navigation

    var selectedNavItem: NavigationItem = .dashboard

    /// Listing ID for cross-feature deep linking (e.g. copilot chat -> listing detail).
    var deepLinkListingId: Int?

    // MARK: - Connection

    var connectionStatus: ConnectionStatus = .disconnected

    // MARK: - Alerts

    var unreadAlertCount: Int = 0

    // MARK: - Settings Errors

    var settingsErrorMessage: String?

    // MARK: - Settings

    var apiBaseURL: String {
        get { UserDefaults.standard.string(forKey: "apiBaseURL") ?? "http://localhost:8080" }
        set { UserDefaults.standard.set(newValue, forKey: "apiBaseURL") }
    }

    var apiToken: String = ""

    var refreshIntervalSeconds: Int {
        get { UserDefaults.standard.integer(forKey: "refreshInterval").clamped(to: 10...3600, default: 60) }
        set { UserDefaults.standard.set(newValue, forKey: "refreshInterval") }
    }

    var notificationsEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "notificationsEnabled") }
        set { UserDefaults.standard.set(newValue, forKey: "notificationsEnabled") }
    }

    var notifyOnNewMatch: Bool {
        get { UserDefaults.standard.object(forKey: "notifyOnNewMatch") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "notifyOnNewMatch") }
    }

    var notifyOnPriceDrop: Bool {
        get { UserDefaults.standard.object(forKey: "notifyOnPriceDrop") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "notifyOnPriceDrop") }
    }

    var notifyOnScoreChange: Bool {
        get { UserDefaults.standard.object(forKey: "notifyOnScoreChange") as? Bool ?? false }
        set { UserDefaults.standard.set(newValue, forKey: "notifyOnScoreChange") }
    }

    // MARK: - Copilot Provider
    // These are stored properties so @Observable tracks changes correctly.
    // Keychain-backed values are loaded lazily to avoid access prompts during app init.

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

    /// Cached Claude subscription status (checked once at init, refreshable).
    var claudeSubscriptionAvailable: Bool = false
    var claudeSubscriptionType: String?

    private var didLoadConnectionSecrets = false
    private var didLoadConnectionSecretsWithInteraction = false
    private var didLoadCopilotSecrets = false
    private var didLoadCopilotSecretsWithInteraction = false
    private var didLoadClaudeSubscription = false
    private static let staleSecretsCleanupVersionKey = "appState.didRunStaleSecretsCleanup.v1"

    /// The active API key for the current provider, resolving Claude subscription OAuth.
    var activeCopilotApiKey: String {
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

    func loadSettingsSecretsIfNeeded() {
        loadConnectionSecretsIfNeeded(allowUserInteraction: true)
        loadCopilotSecretsIfNeeded(allowUserInteraction: true)
    }

    func loadConnectionSecretForUserAction() {
        loadConnectionSecretsIfNeeded(allowUserInteraction: true)
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

    func clearSettingsError() {
        settingsErrorMessage = nil
    }

    func testConnection(baseURL: String, token: String) async {
        let normalizedBaseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalizedBaseURL.isEmpty else {
            settingsErrorMessage = "Base URL is required."
            connectionStatus = .disconnected
            return
        }

        settingsErrorMessage = nil
        connectionStatus = .connecting

        let client = APIClient(
            baseURL: normalizedBaseURL,
            authToken: normalizedToken.isEmpty ? nil : normalizedToken
        )
        let connected = await client.testConnection()
        connectionStatus = connected ? .connected : .disconnected
    }

    func applyConnectionSettings(baseURL: String, token: String) async {
        let normalizedBaseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalizedBaseURL.isEmpty else {
            settingsErrorMessage = "Base URL is required."
            return
        }

        clearSettingsError()

        guard persistSecret(
            value: normalizedToken,
            key: "apiToken",
            label: "API token",
            syncLiveAuthToken: false
        ) else {
            return
        }

        apiToken = normalizedToken
        didLoadConnectionSecrets = true
        didLoadConnectionSecretsWithInteraction = true
        UserDefaults.standard.set(normalizedBaseURL, forKey: "apiBaseURL")
        await apiClient.updateBaseURL(normalizedBaseURL)
        await apiClient.updateAuthToken(normalizedToken.isEmpty ? "dev-token" : normalizedToken)

        alertStream.disconnect()
        await refreshConnection()
    }

    func applyCopilotSettings(
        provider: CopilotProvider,
        anthropicKey: String,
        openAIKey: String,
        model: String
    ) async {
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
                return
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
                return
            }
            openaiApiKey = normalizedOpenAIKey
            didLoadCopilotSecrets = true
            didLoadCopilotSecretsWithInteraction = true
        case .claudeSubscription:
            break
        }

        copilotProvider = provider
        copilotModel = normalizedModel
    }

    // MARK: - API Client

    let apiClient: APIClient

    // MARK: - Streaming

    let alertStream = AlertStreamService()

    // MARK: - Cache

    let localCache = LocalCache()
    let localRuntime = LocalRuntimeService()

    // MARK: - Init

    init() {
        let baseURL = UserDefaults.standard.string(forKey: "apiBaseURL") ?? "http://localhost:8080"
        self.apiClient = APIClient(
            baseURL: baseURL,
            authToken: "dev-token"
        )

        // Request notification permission on launch
        if UserDefaults.standard.bool(forKey: "notificationsEnabled") {
            NotificationManager.shared.requestPermission()
        }

        runSilentStaleSecretsCleanupIfNeeded()
    }

    // MARK: - Actions

    func navigateTo(_ item: NavigationItem) {
        selectedNavItem = item
    }

    func openListing(_ listingId: Int) {
        deepLinkListingId = listingId
        selectedNavItem = .listings
    }

    func refreshConnection(userInitiated: Bool = false) async {
        loadConnectionSecretsIfNeeded(allowUserInteraction: userInitiated)
        await apiClient.updateAuthToken(apiToken.isEmpty ? "dev-token" : apiToken)

        connectionStatus = .connecting
        let connected = await apiClient.testConnection()
        connectionStatus = connected ? .connected : .disconnected

        if connected {
            await refreshUnreadCount()
            if !alertStream.isConnected {
                alertStream.connect(baseURL: apiBaseURL, token: apiToken.isEmpty ? "dev-token" : apiToken)
            }
        } else if alertStream.isConnected {
            alertStream.disconnect()
        }
    }

    func handleStreamAlert(_ alert: Alert) {
        unreadAlertCount += 1

        guard notificationsEnabled else { return }

        let shouldNotify: Bool
        switch alert.alertType {
        case .newMatch:
            shouldNotify = notifyOnNewMatch
        case .priceDrop:
            shouldNotify = notifyOnPriceDrop
        case .scoreUpgrade, .scoreDowngrade:
            shouldNotify = notifyOnScoreChange
        case .statusChange:
            shouldNotify = notifyOnNewMatch
        }

        if shouldNotify {
            NotificationManager.shared.postAlertNotification(
                title: alert.title,
                body: alert.body
            )
        }
    }

    func refreshUnreadCount() async {
        do {
            unreadAlertCount = try await apiClient.fetchUnreadCount()
        } catch {
            // Silently fail — count stays at last known value
        }
    }

    func cleanupStoredSecrets() {
        cleanupIfEmpty(key: "apiToken", allowUserInteraction: true)
        cleanupIfEmpty(key: "anthropicApiKey", allowUserInteraction: true)
        cleanupIfEmpty(key: "openaiApiKey", allowUserInteraction: true)
    }

    @discardableResult
    private func persistSecret(
        value: String,
        key: String,
        label: String,
        syncLiveAuthToken: Bool = true
    ) -> Bool {
        do {
            if value.isEmpty {
                _ = KeychainHelper.delete(key: key)
            } else {
                try KeychainHelper.set(key: key, value: value)
            }
            settingsErrorMessage = nil

            if syncLiveAuthToken, key == "apiToken" {
                Task {
                    await apiClient.updateAuthToken(value.isEmpty ? "dev-token" : value)
                }
            }

            return true
        } catch {
            settingsErrorMessage = "Couldn’t save \(label). \(error.localizedDescription)"
            return false
        }
    }

    private func loadConnectionSecretsIfNeeded(allowUserInteraction: Bool) {
        if didLoadConnectionSecrets && (!allowUserInteraction || didLoadConnectionSecretsWithInteraction) {
            return
        }

        apiToken = KeychainHelper.get(
            key: "apiToken",
            allowUserInteraction: allowUserInteraction
        ) ?? ""
        if allowUserInteraction, apiToken.isEmpty {
            _ = KeychainHelper.delete(key: "apiToken")
        }
        didLoadConnectionSecrets = true
        didLoadConnectionSecretsWithInteraction = allowUserInteraction
    }

    private func loadCopilotSecretsIfNeeded(allowUserInteraction: Bool) {
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

    private func runSilentStaleSecretsCleanupIfNeeded() {
        guard !UserDefaults.standard.bool(forKey: Self.staleSecretsCleanupVersionKey) else { return }

        cleanupIfEmpty(key: "apiToken", allowUserInteraction: false)
        cleanupIfEmpty(key: "anthropicApiKey", allowUserInteraction: false)
        cleanupIfEmpty(key: "openaiApiKey", allowUserInteraction: false)

        UserDefaults.standard.set(true, forKey: Self.staleSecretsCleanupVersionKey)
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
