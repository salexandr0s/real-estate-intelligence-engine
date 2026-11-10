import SwiftUI

/// Menu bar extra dropdown content with alerts summary and quick actions.
struct MenuBarContent: View {
    @Environment(AppState.self) private var appState
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        switch appState.alertsState.loadedUnreadAlertCount {
        case .some(let count) where count > 0:
            Text("^[\(count) unread alert](inflect: true)")
                .font(.headline)
        case .some:
            Text("No unread alerts")
                .foregroundStyle(.secondary)
        case .none:
            // Until the server reports the count, "No unread alerts" could be wrong.
            Text("Unread alerts not loaded")
                .foregroundStyle(.secondary)
        }

        Divider()

        Button("Open Dashboard") {
            showMainWindow(at: .dashboard)
        }
        .keyboardShortcut("1", modifiers: .command)

        Button("View Alerts") {
            showMainWindow(at: .alerts)
        }
        .keyboardShortcut("5", modifiers: .command)

        Divider()

        // Command-R belongs to Refresh Data in the main menu.
        Button("Refresh") {
            appState.requestRefresh()
        }

        Divider()

        Button("Quit ImmoRadar") {
            NSApplication.shared.terminate(nil)
        }
    }

    private func showMainWindow(at item: NavigationItem) {
        appState.navigateTo(item)
        openWindow(id: ImmoRadarApp.mainWindowID)
        NSApp.activate()
    }
}
