import SwiftUI

// MARK: - Navigation

/// Sidebar navigation items.
enum NavigationItem: String, CaseIterable, Identifiable {
    case dashboard
    case listings
    case filters
    case alerts
    case sources
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .listings: return "Listings"
        case .filters: return "Filters"
        case .alerts: return "Alerts"
        case .sources: return "Sources"
        case .settings: return "Settings"
        }
    }

    var icon: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .listings: return "building.2"
        case .filters: return "line.3.horizontal.decrease.circle"
        case .alerts: return "bell"
        case .sources: return "antenna.radiowaves.left.and.right"
        case .settings: return "gearshape"
        }
    }

    /// Keyboard shortcut number (Cmd+1 through Cmd+6).
    var shortcutKey: KeyEquivalent? {
        switch self {
        case .dashboard: return "1"
        case .listings: return "2"
        case .filters: return "3"
        case .alerts: return "4"
        case .sources: return "5"
        case .settings: return "6"
        }
    }
}

// MARK: - Connection Status

enum ConnectionStatus: Equatable {
    case connected
    case connecting
    case disconnected
    case error(String)

    var displayName: String {
        switch self {
        case .connected: return "Connected"
        case .connecting: return "Connecting..."
        case .disconnected: return "Disconnected"
        case .error(let msg): return "Error: \(msg)"
        }
    }

    var iconName: String {
        switch self {
        case .connected: return "circle.fill"
        case .connecting: return "arrow.triangle.2.circlepath"
        case .disconnected: return "circle"
        case .error: return "exclamationmark.circle.fill"
        }
    }

    var color: Color {
        switch self {
        case .connected: return .green
        case .connecting: return .orange
        case .disconnected: return .secondary
        case .error: return .red
        }
    }
}

// MARK: - App State

/// Central observable state for the application.
/// Tracks navigation, connection status, and global counters.
@Observable
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
        get { UserDefaults.standard.string(forKey: "apiToken") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "apiToken") }
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

    lazy var apiClient: APIClient = {
        APIClient(
            baseURL: apiBaseURL,
            authToken: apiToken.isEmpty ? nil : apiToken
        )
    }()

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
        return min(max(self, range.lowerBound), range.upperBound)
    }
}
