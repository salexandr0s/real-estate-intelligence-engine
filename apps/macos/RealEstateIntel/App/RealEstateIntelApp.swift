import SwiftUI

@main
struct RealEstateIntelApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        // MARK: - Main Window

        WindowGroup {
            ContentView()
                .environment(appState)
                .onAppear {
                    Task {
                        await appState.refreshConnection()
                    }
                }
        }
        .defaultSize(width: 1200, height: 800)
        .commands {
            navigationCommands
            viewCommands
        }

        // MARK: - Menu Bar Extra

        MenuBarExtra {
            menuBarContent
        } label: {
            menuBarLabel
        }
    }

    // MARK: - Keyboard Shortcut Commands

    private var navigationCommands: some Commands {
        CommandGroup(after: .sidebar) {
            Divider()
            ForEach(NavigationItem.allCases) { item in
                if let key = item.shortcutKey {
                    Button(item.title) {
                        appState.navigateTo(item)
                    }
                    .keyboardShortcut(key, modifiers: .command)
                }
            }
        }
    }

    private var viewCommands: some Commands {
        CommandGroup(after: .toolbar) {
            Button("Refresh Data") {
                Task {
                    await appState.refreshConnection()
                }
            }
            .keyboardShortcut("r", modifiers: .command)
        }
    }

    // MARK: - Menu Bar Extra Content

    private var menuBarLabel: some View {
        HStack(spacing: 4) {
            Image(systemName: "building.2")
            if appState.unreadAlertCount > 0 {
                Text("\(appState.unreadAlertCount)")
                    .font(.caption2.monospacedDigit())
            }
        }
    }

    @ViewBuilder
    private var menuBarContent: some View {
        if appState.unreadAlertCount > 0 {
            Text("\(appState.unreadAlertCount) unread alert\(appState.unreadAlertCount == 1 ? "" : "s")")
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
        .keyboardShortcut("4", modifiers: .command)

        Divider()

        Button("Refresh") {
            Task {
                await appState.refreshConnection()
            }
        }
        .keyboardShortcut("r", modifiers: .command)

        Divider()

        Button("Quit Real Estate Intel") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q", modifiers: .command)
    }
}
