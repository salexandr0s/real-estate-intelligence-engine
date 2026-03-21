import SwiftUI

/// Detail content switching on the selected navigation item.
struct DetailContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        switch appState.selectedNavItem {
        case .dashboard:
            DashboardView()
        case .listings:
            ListingsView()
        case .filters:
            FiltersView()
        case .alerts:
            AlertsView()
        case .sources:
            SourcesView()
        case .settings:
            SettingsView()
        }
    }
}
