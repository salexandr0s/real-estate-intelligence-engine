import SwiftUI

/// Sidebar with navigation sections and connection status.
struct SidebarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var navigationState = appState.navigationState

        List(selection: $navigationState.selectedNavItem) {
            Section("Workspace") {
                ForEach([NavigationItem.dashboard, .listings, .watchlist, .outreach, .filters, .copilot]) { item in
                    SidebarRow(item: item, unreadAlertCount: appState.alertsState.unreadAlertCount)
                }
            }

            Section("Monitoring") {
                ForEach([NavigationItem.alerts, .sources, .analytics]) { item in
                    SidebarRow(item: item, unreadAlertCount: appState.alertsState.unreadAlertCount)
                }
            }

            Section {
                SidebarRow(item: .settings, unreadAlertCount: appState.alertsState.unreadAlertCount)
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            ConnectionStatusBar()
        }
        .navigationSplitViewColumnWidth(min: 170, ideal: 210, max: 250)
    }
}
