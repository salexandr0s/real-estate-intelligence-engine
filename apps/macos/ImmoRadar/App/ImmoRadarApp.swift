import CoreSpotlight
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
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    if let listingId = SpotlightIndexer.listingID(from: activity) {
                        appState.openListing(listingId)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .intentNavigate)) { notification in
                    if let sectionId = notification.object as? String,
                       let item = NavigationItem(rawValue: sectionId) {
                        appState.selectedNavItem = item
                    }
                }
        }
        .defaultSize(width: 1200, height: 800)
        .windowToolbarStyle(.unified)
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

        // MARK: - Settings

        Settings {
            SettingsView()
                .environment(appState)
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
