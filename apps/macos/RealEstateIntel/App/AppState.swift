import SwiftUI

// MARK: - App State

/// Central observable state for the application.
/// Tracks navigation, connection status, and global counters.
@MainActor @Observable
final class AppState {

    // MARK: - Navigation

    var selectedNavItem: NavigationItem = .dashboard

    // MARK: - Connection

    var connectionStatus: ConnectionStatus = .disconnected

    // MARK: - Alerts

    var unreadAlertCount: Int = 3

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

    // MARK: - API Client

    let apiClient: APIClient

    // MARK: - Init

    init() {
        let baseURL = UserDefaults.standard.string(forKey: "apiBaseURL") ?? "http://localhost:8080"
        let token = KeychainHelper.get(key: "apiToken") ?? ""
        self.apiClient = APIClient(
            baseURL: baseURL,
            authToken: token.isEmpty ? nil : token
        )
    }

    // MARK: - Actions

    func navigateTo(_ item: NavigationItem) {
        selectedNavItem = item
    }

    func refreshConnection() async {
        connectionStatus = .connecting
        let connected = await apiClient.testConnection()
        connectionStatus = connected ? .connected : .disconnected
    }
}

// MARK: - Int Clamping Helper

private extension Int {
    func clamped(to range: ClosedRange<Int>, default defaultValue: Int) -> Int {
        if self == 0 { return defaultValue }
        return Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}
