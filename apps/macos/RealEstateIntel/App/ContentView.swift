import SwiftUI

/// Root view with NavigationSplitView sidebar and detail content.
struct ContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        NavigationSplitView {
            sidebar
        } detail: {
            detailContent
        }
        .navigationSplitViewStyle(.balanced)
        .frame(minWidth: 1000, minHeight: 600)
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        List(selection: Bindable(appState).selectedNavItem) {
            Section("Workspace") {
                ForEach([NavigationItem.dashboard, .listings, .filters]) { item in
                    sidebarRow(item)
                }
            }

            Section("Monitoring") {
                ForEach([NavigationItem.alerts, .sources]) { item in
                    sidebarRow(item)
                }
            }

            Section {
                sidebarRow(.settings)
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            connectionStatusBar
        }
        .frame(minWidth: 200)
    }

    private func sidebarRow(_ item: NavigationItem) -> some View {
        Label {
            HStack {
                Text(item.title)
                Spacer()
                if item == .alerts && appState.unreadAlertCount > 0 {
                    Text("\(appState.unreadAlertCount)")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.red, in: Capsule())
                }
            }
        } icon: {
            Image(systemName: item.icon)
        }
        .tag(item)
    }

    private var connectionStatusBar: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: appState.connectionStatus.iconName)
                .foregroundStyle(appState.connectionStatus.color)
                .font(.caption)
            Text(appState.connectionStatus.displayName)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.sm)
    }

    // MARK: - Detail Content

    @ViewBuilder
    private var detailContent: some View {
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

#Preview {
    ContentView()
        .environment(AppState())
}
