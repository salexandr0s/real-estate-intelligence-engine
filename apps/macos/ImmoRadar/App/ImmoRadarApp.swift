import CoreSpotlight
import Darwin
import SwiftUI

@MainActor
final class AppTerminationBridge {
    static let shared = AppTerminationBridge()

    var appState: AppState?
}

@MainActor
final class AppLifecycleDelegate: NSObject, NSApplicationDelegate {

    private var isTerminationInProgress = false
    private var signalSource: DispatchSourceSignal?

    override init() {
        super.init()
        signal(SIGTERM, SIG_IGN)

        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler {
            Task { @MainActor in
                NSApplication.shared.terminate(nil)
            }
        }
        source.resume()
        signalSource = source
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            await Self.terminateDuplicateAppProcesses()

            await AppTerminationBridge.shared.appState?.performInitialLaunchIfNeeded()
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !isTerminationInProgress else { return .terminateLater }
        isTerminationInProgress = true

        Task { @MainActor in
            await AppTerminationBridge.shared.appState?.prepareForTermination()
            sender.reply(toApplicationShouldTerminate: true)
        }

        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Keep the local engine alive across app relaunches so a fresh Debug run
        // can reconnect to the same managed runtime instead of tearing it down
        // mid-startup while Launch Services replaces the app process.
    }

    private nonisolated static func terminateDuplicateAppProcesses() async {
        let currentProcessID = ProcessInfo.processInfo.processIdentifier
        let duplicatePIDs = await duplicateAppPIDs(excluding: currentProcessID)

        guard !duplicatePIDs.isEmpty else { return }

        for pid in duplicatePIDs {
            Darwin.kill(pid, SIGTERM)
        }

        try? await Task.sleep(for: .seconds(1))

        for pid in duplicatePIDs where isProcessRunning(pid) {
            Darwin.kill(pid, SIGKILL)
        }
    }

    private nonisolated static func duplicateAppPIDs(excluding currentProcessID: Int32) async -> [Int32] {
        await Task.detached(priority: .utility) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/ps")
            process.arguments = ["-axo", "pid=,command="]

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = Pipe()

            do {
                try process.run()
            } catch {
                return []
            }

            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()

            guard process.terminationStatus == 0 else { return [] }

            return String(decoding: data, as: UTF8.self)
                .split(whereSeparator: \.isNewline)
                .compactMap { rawLine -> Int32? in
                    let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard line.contains("/ImmoRadar.app/Contents/MacOS/ImmoRadar") else { return nil }

                    let parts = line.split(maxSplits: 1, whereSeparator: \.isWhitespace)
                    guard let pidPart = parts.first,
                          let pid = Int32(pidPart),
                          pid != currentProcessID else {
                        return nil
                    }

                    return pid
                }
        }.value
    }

    private nonisolated static func isProcessRunning(_ pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        return Darwin.kill(pid, 0) == 0
    }
}

@main
struct ImmoRadarApp: App {
    @NSApplicationDelegateAdaptor(AppLifecycleDelegate.self) private var appLifecycleDelegate
    private let launchMode: AppLaunchMode
    @State private var appState: AppState

    init() {
        let launchMode = AppLaunchMode.current
        self.launchMode = launchMode
        let appState = AppState(launchMode: launchMode)
        _appState = State(initialValue: appState)
        AppTerminationBridge.shared.appState = appState

        Task { @MainActor in
            await appState.performInitialLaunchIfNeeded()
        }
    }

    var body: some Scene {
        // MARK: - Main Window

        Window("ImmoRadar", id: "main") {
            if launchMode == .test {
                EmptyView()
                    .frame(width: 1, height: 1)
                    .environment(appState)
            } else {
                ContentView()
                    .environment(appState)
                    .onContinueUserActivity(CSSearchableItemActionType) { activity in
                        if let listingId = SpotlightIndexer.listingID(from: activity) {
                            appState.navigationState.openListing(listingId)
                        }
                    }
                    .onReceive(NotificationCenter.default.publisher(for: .intentNavigate)) { notification in
                        if let sectionId = notification.object as? String,
                           let item = NavigationItem(rawValue: sectionId) {
                            appState.navigationState.selectedNavItem = item
                        }
                    }
            }
        }
        .defaultSize(width: launchMode == .test ? 1 : 1200, height: launchMode == .test ? 1 : 800)
        .windowToolbarStyle(.unified)
        .commands {
            navigationCommands
            viewCommands
        }

        MenuBarExtra {
            if launchMode == .test {
                EmptyView()
            } else {
                MenuBarContent()
                    .environment(appState)
            }
        } label: {
            MenuBarLabel(unreadAlertCount: launchMode == .test ? 0 : appState.alertsState.unreadAlertCount)
        }

        Settings {
            if launchMode == .test {
                EmptyView()
            } else {
                SettingsView()
                    .environment(appState)
            }
        }
    }

    // MARK: - Keyboard Shortcut Commands

    private var navigationCommands: some Commands {
        CommandGroup(after: .sidebar) {
            Divider()
            ForEach(NavigationItem.allCases) { item in
                if let key = item.shortcutKey {
                    Button(item.title) {
                        appState.navigationState.navigateTo(item)
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
                    await appState.refreshConnection(userInitiated: true)
                }
            }
            .keyboardShortcut("r", modifiers: .command)
        }
    }
}
