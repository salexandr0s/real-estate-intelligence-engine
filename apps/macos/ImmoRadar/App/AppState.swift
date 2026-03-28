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

    var apiToken: String {
        get { KeychainHelper.get(key: "apiToken") ?? "" }
        set {
            _ = persistSecret(
                value: newValue,
                key: "apiToken",
                label: "API token"
            )
        }
    }

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
    // They sync to UserDefaults/Keychain in didSet.

    var copilotProvider: CopilotProvider = {
        let raw = UserDefaults.standard.string(forKey: "copilotProvider") ?? "anthropic"
        return CopilotProvider(rawValue: raw) ?? .anthropic
    }() {
        didSet { UserDefaults.standard.set(copilotProvider.rawValue, forKey: "copilotProvider") }
    }

    var anthropicApiKey: String = KeychainHelper.get(key: "anthropicApiKey") ?? "" {
        didSet {
            _ = persistSecret(
                value: anthropicApiKey,
                key: "anthropicApiKey",
                label: "Anthropic API key"
            )
        }
    }

    var openaiApiKey: String = KeychainHelper.get(key: "openaiApiKey") ?? "" {
        didSet {
            _ = persistSecret(
                value: openaiApiKey,
                key: "openaiApiKey",
                label: "OpenAI API key"
            )
        }
    }

    var copilotModel: String = UserDefaults.standard.string(forKey: "copilotModel") ?? "" {
        didSet { UserDefaults.standard.set(copilotModel, forKey: "copilotModel") }
    }

    /// Cached Claude subscription status (checked once at init, refreshable).
    var claudeSubscriptionAvailable: Bool = false
    var claudeSubscriptionType: String?

    /// The active API key for the current provider, resolving Claude subscription OAuth.
    var activeCopilotApiKey: String {
        switch copilotProvider {
        case .anthropic:
            return anthropicApiKey
        case .openai:
            return openaiApiKey
        case .claudeSubscription:
            return ClaudeAuthHelper.loadOAuthToken() ?? ""
        }
    }

    func refreshClaudeSubscription() {
        claudeSubscriptionAvailable = ClaudeAuthHelper.isAvailable
        claudeSubscriptionType = ClaudeAuthHelper.subscriptionType
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

        UserDefaults.standard.set(normalizedBaseURL, forKey: "apiBaseURL")
        await apiClient.updateBaseURL(normalizedBaseURL)
        await apiClient.updateAuthToken(normalizedToken.isEmpty ? nil : normalizedToken)

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
        case .openai:
            guard persistSecret(
                value: normalizedOpenAIKey,
                key: "openaiApiKey",
                label: "OpenAI API key"
            ) else {
                return
            }
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

    // MARK: - Init

    init() {
        let baseURL = UserDefaults.standard.string(forKey: "apiBaseURL") ?? "http://localhost:8080"
        let token = KeychainHelper.get(key: "apiToken") ?? ""
        self.apiClient = APIClient(
            baseURL: baseURL,
            authToken: token.isEmpty ? "dev-token" : token
        )

        // Request notification permission on launch
        if UserDefaults.standard.bool(forKey: "notificationsEnabled") {
            NotificationManager.shared.requestPermission()
        }

        // Check for Claude subscription
        refreshClaudeSubscription()
    }

    // MARK: - Actions

    func navigateTo(_ item: NavigationItem) {
        selectedNavItem = item
    }

    func openListing(_ listingId: Int) {
        deepLinkListingId = listingId
        selectedNavItem = .listings
    }

    func refreshConnection() async {
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

    @discardableResult
    private func persistSecret(
        value: String,
        key: String,
        label: String,
        syncLiveAuthToken: Bool = true
    ) -> Bool {
        do {
            try KeychainHelper.set(key: key, value: value)
            settingsErrorMessage = nil

            if syncLiveAuthToken, key == "apiToken" {
                Task {
                    await apiClient.updateAuthToken(value.isEmpty ? nil : value)
                }
            }

            return true
        } catch {
            settingsErrorMessage = "Couldn’t save \(label). \(error.localizedDescription)"
            return false
        }
    }
}
