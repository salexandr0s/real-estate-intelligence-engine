import SwiftUI

/// Dashboard header with title and refresh button.
struct DashboardHeader: View {
    let isLoading: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Text("Dashboard")
                    .font(.largeTitle.bold())
                Text("Real estate market intelligence overview")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(action: onRefresh) {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .disabled(isLoading)
        }
    }
}
