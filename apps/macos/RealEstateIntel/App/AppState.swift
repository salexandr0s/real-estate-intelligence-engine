import SwiftUI

// MARK: - Copilot Provider

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

    // MARK: - Settings

    var apiBaseURL: String {
        get { UserDefaults.standard.string(forKey: "apiBaseURL") ?? "http://localhost:8080" }
        set { UserDefaults.standard.set(newValue, forKey: "apiBaseURL") }
    }

    var apiToken: String {
        get { KeychainHelper.get(key: "apiToken") ?? "" }
        set { try? KeychainHelper.set(key: "apiToken", value: newValue) }
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
        didSet { try? KeychainHelper.set(key: "anthropicApiKey", value: anthropicApiKey) }
    }

    var openaiApiKey: String = KeychainHelper.get(key: "openaiApiKey") ?? "" {
        didSet { try? KeychainHelper.set(key: "openaiApiKey", value: openaiApiKey) }
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

    func refreshConnection() async {
        connectionStatus = .connecting
        let connected = await apiClient.testConnection()
        connectionStatus = connected ? .connected : .disconnected

        if connected {
            await refreshUnreadCount()
            if !alertStream.isConnected {
                alertStream.connect(baseURL: apiBaseURL, token: apiToken.isEmpty ? "dev-token" : apiToken)
            }
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
}

// MARK: - Int Clamping Helper

private extension Int {
    func clamped(to range: ClosedRange<Int>, default defaultValue: Int) -> Int {
        if self == 0 { return defaultValue }
        return Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}
