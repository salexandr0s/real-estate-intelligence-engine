import SwiftUI

/// Dashboard overview with summary cards, recent high-score listings, and source health.
struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = DashboardViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                DashboardHeader(isLoading: viewModel.isLoading) {
                    Task { await viewModel.refresh(using: appState.apiClient) }
                }
                SummaryGridView(cards: viewModel.summaryCards)
                HStack(alignment: .top, spacing: Theme.Spacing.xl) {
                    RecentListingsSection(listings: viewModel.recentHighScoreListings)
                    SourceHealthSection(
                        sources: viewModel.sources,
                        healthyCount: viewModel.healthySources,
                        activeCount: viewModel.activeSources
                    )
                }
            }
            .padding(Theme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .navigationTitle("Dashboard")
        .task {
            await viewModel.refresh(using: appState.apiClient)
        }
    }
}

#Preview {
    DashboardView()
        .environment(AppState())
        .frame(width: 900, height: 700)
}
