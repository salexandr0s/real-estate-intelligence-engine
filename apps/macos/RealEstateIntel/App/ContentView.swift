import SwiftUI
import Combine

/// Root view with NavigationSplitView sidebar and detail content.
struct ContentView: View {
    @Environment(AppState.self) private var appState

    /// 5-minute background refresh timer.
    private let refreshTimer = Timer.publish(every: 300, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationSplitView {
            SidebarView()
        } detail: {
            DetailContentView()
        }
        .navigationSplitViewStyle(.balanced)
        .frame(minWidth: 1000, minHeight: 600)
        .onReceive(refreshTimer) { _ in
            Task {
                await appState.refreshConnection()
            }
        }
    }
}

#Preview {
    ContentView()
        .environment(AppState())
}
