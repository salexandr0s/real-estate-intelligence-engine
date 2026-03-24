import SwiftUI

/// Dashboard overview — dense, single-screen layout with weighted rows.
struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = DashboardViewModel()

    var body: some View {
        GeometryReader { geo in
            let contentWidth = geo.size.width - Theme.Spacing.lg * 2
            let gap = Theme.Spacing.md
            let primaryHeight = max(260, min(340, (geo.size.height - 300) * 0.48))
            let actionHeight = max(300, min(420, (geo.size.height - 300) * 0.48))

            ScrollView {
                VStack(alignment: .leading, spacing: gap) {
                    // Header
                    DashboardHeader(
                        lastRefresh: viewModel.lastRefreshDate,
                        isLoading: viewModel.isLoading
                    ) {
                        Task { await viewModel.refresh(using: appState.apiClient) }
                    }

                    // Tier 1: Compact summary metrics
                    SummaryGridView(
                        cards: viewModel.enhancedSummaryCards(
                            unreadAlertCount: appState.unreadAlertCount
                        )
                    )

                    // Tier 2: Primary analytics — 55% district | 45% trends
                    HStack(alignment: .top, spacing: gap) {
                        DistrictComparisonChart(data: viewModel.districtComparison)
                            .frame(width: (contentWidth - gap) * 0.55,
                                   height: primaryHeight)

                        DashboardPriceTrendChart(data: viewModel.districtTrends)
                            .frame(width: (contentWidth - gap) * 0.45,
                                   height: primaryHeight)
                    }

                    // Tier 3: 40% opportunities | 30% scores+sources | 30% temperature
                    HStack(alignment: .top, spacing: gap) {
                        TopOpportunitiesSection(
                            listings: viewModel.topOpportunities,
                            districtComparison: viewModel.districtComparison,
                            onListingTap: { id in
                                appState.deepLinkListingId = id
                                appState.selectedNavItem = .listings
                            }
                        )
                        .frame(width: (contentWidth - gap * 2) * 0.40,
                               height: actionHeight)

                        VStack(spacing: gap) {
                            ScoreDistributionChart(data: viewModel.scoreDistribution)
                            PipelineHealthGrid(sources: viewModel.sources)
                        }
                        .frame(width: (contentWidth - gap * 2) * 0.30,
                               height: actionHeight)

                        MarketHeatGrid(data: viewModel.temperatureData)
                            .frame(width: (contentWidth - gap * 2) * 0.30,
                                   height: actionHeight)
                    }
                }
                .padding(Theme.Spacing.lg)
            }
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
        .frame(width: 1100, height: 800)
}
