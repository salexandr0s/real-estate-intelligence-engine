import SwiftUI

/// Dashboard overview with summary cards, recent high-score listings, and source health.
/// Uses a fixed single-page layout where cards fill available space and scroll internally.
struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = DashboardViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
            DashboardHeader(isLoading: viewModel.isLoading) {
                Task { await viewModel.refresh(using: appState.apiClient) }
            }
            SummaryGridView(cards: viewModel.summaryCards)
            HStack(alignment: .top, spacing: Theme.Spacing.xl) {
                RecentListingsSection(listings: viewModel.recentHighScoreListings)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                MarketTemperatureCard(data: viewModel.temperatureData)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                SourceHealthSection(
                    sources: viewModel.sources,
                    healthyCount: viewModel.healthySources,
                    activeCount: viewModel.activeSources
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .padding(Theme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
