import SwiftUI

/// Detail content switching on the selected navigation item.
struct DetailContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        switch appState.navigationState.selectedNavItem {
        case .dashboard:
            DashboardView()
        case .listings:
            ListingsView()
        case .filters:
            FiltersView()
        case .copilot:
            CopilotView()
        case .alerts:
            AlertsView()
        case .watchlist:
            WatchlistView()
        case .outreach:
            OutreachView()
        case .sources:
            SourcesView()
        case .analytics:
            AnalyticsView()
        case .settings:
            SettingsView()
        }
    }
}
