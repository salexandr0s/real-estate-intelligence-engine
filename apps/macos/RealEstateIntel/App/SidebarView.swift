import SwiftUI

/// Sidebar with navigation sections and connection status.
struct SidebarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        List(selection: Bindable(appState).selectedNavItem) {
            Section("Workspace") {
                ForEach([NavigationItem.dashboard, .listings, .filters, .copilot]) { item in
                    SidebarRow(item: item, unreadAlertCount: appState.unreadAlertCount)
                }
            }

            Section("Monitoring") {
                ForEach([NavigationItem.alerts, .sources, .analytics]) { item in
                    SidebarRow(item: item, unreadAlertCount: appState.unreadAlertCount)
                }
            }

            Section {
                SidebarRow(item: .settings, unreadAlertCount: appState.unreadAlertCount)
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            ConnectionStatusBar()
        }
        .navigationSplitViewColumnWidth(min: 160, ideal: 200, max: 240)
    }
}
