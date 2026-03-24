import SwiftUI

/// Connection status indicator shown at bottom of sidebar.
struct ConnectionStatusBar: View {
    @Environment(AppState.self) private var appState

    var body: some View {
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
}
