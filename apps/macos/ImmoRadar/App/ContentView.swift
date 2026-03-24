import SwiftUI

/// Root view with NavigationSplitView sidebar and detail content.
struct ContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        NavigationSplitView {
            SidebarView()
        } detail: {
            DetailContentView()
        }
        .navigationSplitViewStyle(.balanced)
        .frame(minWidth: 1100, minHeight: 600)
        .task(id: appState.refreshIntervalSeconds) {
            let interval = appState.refreshIntervalSeconds
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(interval))
                guard !Task.isCancelled else { break }
                await appState.refreshConnection()
            }
        }
        .onChange(of: appState.alertStream.lastEvent?.id) { _, _ in
            if let alert = appState.alertStream.lastEvent {
                appState.handleStreamAlert(alert)
            }
        }
    }
}

#Preview {
    ContentView()
        .environment(AppState())
}
