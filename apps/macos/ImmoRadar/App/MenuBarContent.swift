import SwiftUI

/// Menu bar extra dropdown content with alerts summary and quick actions.
struct MenuBarContent: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        if appState.unreadAlertCount > 0 {
            Text("^[\(appState.unreadAlertCount) unread alert](inflect: true)")
                .font(.headline)
        } else {
            Text("No unread alerts")
                .foregroundStyle(.secondary)
        }

        Divider()

        Button("Open Dashboard") {
            appState.navigateTo(.dashboard)
            NSApp.activate(ignoringOtherApps: true)
        }
        .keyboardShortcut("1", modifiers: .command)

        Button("View Alerts") {
            appState.navigateTo(.alerts)
            NSApp.activate(ignoringOtherApps: true)
        }
        .keyboardShortcut("5", modifiers: .command)

        Divider()

        Button("Refresh") {
            Task {
                await appState.refreshConnection(userInitiated: true)
            }
        }
        .keyboardShortcut("r", modifiers: .command)

        Divider()

        Button("Quit ImmoRadar") {
            NSApplication.shared.terminate(nil)
        }
    }
}
