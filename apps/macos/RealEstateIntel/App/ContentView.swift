import SwiftUI

/// Root view with NavigationSplitView sidebar and detail content.
struct ContentView: View {
    @Environment(AppState.self) private var appState
    @State private var refreshTask: Task<Void, Never>?

    var body: some View {
        NavigationSplitView {
            SidebarView()
        } detail: {
            DetailContentView()
        }
        .navigationSplitViewStyle(.balanced)
        .frame(minWidth: 1000, minHeight: 600)
        .onAppear { startRefreshLoop() }
        .onDisappear { refreshTask?.cancel() }
        .onChange(of: appState.refreshIntervalSeconds) { _, _ in
            startRefreshLoop()
        }
    }

    private func startRefreshLoop() {
        refreshTask?.cancel()
        let interval = appState.refreshIntervalSeconds
        refreshTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(interval))
                guard !Task.isCancelled else { break }
                await appState.refreshConnection()
            }
        }
    }
}

#Preview {
    ContentView()
        .environment(AppState())
}
