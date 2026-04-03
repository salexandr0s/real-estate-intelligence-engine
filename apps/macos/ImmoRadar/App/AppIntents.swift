import AppIntents
import Foundation

// MARK: - Navigation Entity

/// Entity representing a navigable section in the app.
struct NavigationSectionEntity: AppEntity {
    nonisolated(unsafe) static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "App Section")
    nonisolated(unsafe) static var defaultQuery = NavigationSectionQuery()

    var id: String
    var name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }

    static let allSections: [NavigationSectionEntity] = [
        .init(id: "dashboard", name: "Dashboard"),
        .init(id: "listings", name: "Listings"),
        .init(id: "filters", name: "Filters"),
        .init(id: "copilot", name: "Copilot"),
        .init(id: "alerts", name: "Alerts"),
        .init(id: "watchlist", name: "Watchlist"),
        .init(id: "sources", name: "Sources"),
        .init(id: "analytics", name: "Analytics"),
    ]
}

struct NavigationSectionQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [NavigationSectionEntity] {
        NavigationSectionEntity.allSections.filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [NavigationSectionEntity] {
        NavigationSectionEntity.allSections
    }
}

// MARK: - Open Section Intent

/// Opens ImmoRadar to a specific section.
struct OpenSectionIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Open ImmoRadar Section"
    nonisolated(unsafe) static var description = IntentDescription("Opens ImmoRadar and navigates to a specific section.")
    nonisolated(unsafe) static var openAppWhenRun = true

    @Parameter(title: "Section")
    var section: NavigationSectionEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        // Post notification that AppState can observe
        UserDefaults.standard.set(section.id, forKey: "intentNavigateTo")
        NotificationCenter.default.post(name: .intentNavigate, object: section.id)
        return .result()
    }
}

// MARK: - Get Alert Count Intent

/// Returns the current number of unread alerts.
struct GetAlertCountIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Get Unread Alert Count"
    nonisolated(unsafe) static var description = IntentDescription("Returns the number of unread alerts in ImmoRadar.")

    func perform() async throws -> some IntentResult & ReturnsValue<Int> {
        let baseURL = UserDefaults.standard.string(forKey: "apiBaseURL") ?? "http://localhost:8080"
        let token = LocalRuntimeAuth.preferredToken(
            for: baseURL,
            userToken: KeychainHelper.get(key: "apiToken", allowUserInteraction: false),
            allowUserInteraction: false
        )
        let client = APIClient(baseURL: baseURL, authToken: token)
        let unread = try await client.fetchUnreadCount()
        return .result(value: unread)
    }
}

// MARK: - Get Listing Count Intent

/// Returns the number of active listings.
struct GetListingCountIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Get Listing Count"
    nonisolated(unsafe) static var description = IntentDescription("Returns the number of active listings in ImmoRadar.")

    func perform() async throws -> some IntentResult & ReturnsValue<Int> {
        let baseURL = UserDefaults.standard.string(forKey: "apiBaseURL") ?? "http://localhost:8080"
        let token = LocalRuntimeAuth.preferredToken(
            for: baseURL,
            userToken: KeychainHelper.get(key: "apiToken", allowUserInteraction: false),
            allowUserInteraction: false
        )
        let client = APIClient(baseURL: baseURL, authToken: token)
        let stats = try await client.fetchDashboardStats()
        return .result(value: stats.totalActive)
    }
}

// MARK: - App Shortcuts Provider

struct ImmoRadarShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: GetAlertCountIntent(),
            phrases: [
                "How many alerts in \(.applicationName)",
                "Check \(.applicationName) alerts",
            ],
            shortTitle: "Alert Count",
            systemImageName: "bell.badge"
        )
        AppShortcut(
            intent: GetListingCountIntent(),
            phrases: [
                "How many listings in \(.applicationName)",
                "Check \(.applicationName) listings",
            ],
            shortTitle: "Listing Count",
            systemImageName: "building.2"
        )
    }
}

// MARK: - Notification Name

extension Notification.Name {
    static let intentNavigate = Notification.Name("com.immoradar.intentNavigate")
}
