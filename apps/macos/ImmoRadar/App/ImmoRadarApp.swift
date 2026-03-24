import SwiftUI

@main
struct ImmoRadarApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        // MARK: - Main Window

        WindowGroup {
            ContentView()
                .environment(appState)
                .task {
                    await appState.refreshConnection()
                }
        }
        .defaultSize(width: 1200, height: 800)
        .commands {
            navigationCommands
            viewCommands
        }

        // MARK: - Menu Bar Extra

        MenuBarExtra {
            MenuBarContent()
                .environment(appState)
        } label: {
            MenuBarLabel(unreadAlertCount: appState.unreadAlertCount)
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
}
