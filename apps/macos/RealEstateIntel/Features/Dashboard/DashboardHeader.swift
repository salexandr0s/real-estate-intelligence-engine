import SwiftUI

/// Compact dashboard header — last refresh time + refresh button.
struct DashboardHeader: View {
    let lastRefresh: Date?
    let isLoading: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack {
            if isLoading {
                ProgressView()
                    .controlSize(.small)
                Text("Refreshing…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else if let lastRefresh {
                Text("Updated \(PriceFormatter.relativeDate(lastRefresh))")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            Button(action: onRefresh) {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .keyboardShortcut("r", modifiers: .command)
            .disabled(isLoading)
        }
    }
}
