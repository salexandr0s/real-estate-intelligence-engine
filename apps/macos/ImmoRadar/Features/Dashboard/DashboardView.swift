import SwiftUI

/// Dashboard overview — 4-tier layout grouped by cognitive purpose.
struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = DashboardViewModel()

    var body: some View {
        GeometryReader { geo in
            let contentWidth = geo.size.width - Theme.Spacing.lg * 2
            let gap = Theme.Spacing.md
            let isNarrow = contentWidth < 700
            let primaryHeight = max(260, min(340, (geo.size.height - 300) * 0.48))
            let actionHeight = max(300, min(420, (geo.size.height - 300) * 0.48))
            let operationalHeight = max(200, min(280, (geo.size.height - 300) * 0.30))

            ScrollView {
                VStack(alignment: .leading, spacing: gap) {
                    // Tier 1: Compact summary metrics
                    SummaryGridView(
                        cards: viewModel.enhancedSummaryCards(
                            unreadAlertCount: appState.unreadAlertCount
                        ),
                        onCardNavigate: { cardId in
                            switch cardId {
                            case "active-listings", "new-this-week", "high-score":
                                appState.navigateTo(.listings)
                            case "pipeline":
                                appState.navigateTo(.sources)
                            case "active-filters":
                                appState.navigateTo(.filters)
                            case "unread-alerts":
                                appState.navigateTo(.alerts)
                            default:
                                break
                            }
                        }
                    )

                    // Tier 2: Primary analytics — 50/50 split
                    adaptiveRow(isNarrow: isNarrow, spacing: gap) {
                        DistrictComparisonChart(data: viewModel.districtComparison)
                            .frame(
                                width: isNarrow ? nil : (contentWidth - gap) * 0.50,
                                height: isNarrow ? nil : primaryHeight
                            )
                            .frame(maxWidth: isNarrow ? .infinity : nil)

                        DashboardPriceTrendChart(data: viewModel.districtTrends)
                            .frame(
                                width: isNarrow ? nil : (contentWidth - gap) * 0.50,
                                height: isNarrow ? nil : primaryHeight
                            )
                            .frame(maxWidth: isNarrow ? .infinity : nil)
                    }

                    // Tier 3: Actionable intelligence — 55/45 split
                    adaptiveRow(isNarrow: isNarrow, spacing: gap) {
                        TopOpportunitiesSection(
                            listings: viewModel.topOpportunities,
                            districtComparison: viewModel.districtComparison,
                            onListingTap: { id in
                                appState.deepLinkListingId = id
                                appState.selectedNavItem = .listings
                            }
                        )
                        .frame(
                            width: isNarrow ? nil : (contentWidth - gap) * 0.55,
                            height: isNarrow ? nil : actionHeight
                        )
                        .frame(maxWidth: isNarrow ? .infinity : nil)

                        MarketHeatGrid(
                            data: viewModel.temperatureData,
                            onDistrictTap: { _ in appState.navigateTo(.listings) }
                        )
                        .frame(
                            width: isNarrow ? nil : (contentWidth - gap) * 0.45,
                            height: isNarrow ? nil : actionHeight
                        )
                        .frame(maxWidth: isNarrow ? .infinity : nil)
                    }

                    // Tier 4: Operational — 50/50 split, subtle cards
                    adaptiveRow(isNarrow: isNarrow, spacing: gap) {
                        ScoreDistributionChart(data: viewModel.scoreDistribution)
                            .frame(
                                width: isNarrow ? nil : (contentWidth - gap) * 0.50,
                                height: isNarrow ? nil : operationalHeight
                            )
                            .frame(maxWidth: isNarrow ? .infinity : nil)

                        PipelineHealthGrid(
                            sources: viewModel.sources,
                            onSourceTap: { _ in appState.navigateTo(.sources) }
                        )
                        .frame(
                            width: isNarrow ? nil : (contentWidth - gap) * 0.50,
                            height: isNarrow ? nil : operationalHeight
                        )
                        .frame(maxWidth: isNarrow ? .infinity : nil)
                    }
                }
                .padding(Theme.Spacing.lg)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .navigationTitle("Dashboard")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            ToolbarItem(placement: .automatic) {
                if let date = viewModel.lastRefreshDate {
                    Text("Updated \(PriceFormatter.relativeDate(date))")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .toolbar(id: "dashboard") {
            ToolbarItem(id: "refresh", placement: .automatic) {
                Button {
                    Task { await viewModel.refresh(using: appState.apiClient) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(viewModel.isLoading)
                .help("Refresh dashboard")
            }
        }
        .task {
            await viewModel.refresh(using: appState.apiClient)
        }
    }

    // MARK: - Responsive Layout

    @ViewBuilder
    private func adaptiveRow<Content: View>(
        isNarrow: Bool,
        spacing: CGFloat,
        @ViewBuilder content: () -> Content
    ) -> some View {
        if isNarrow {
            VStack(spacing: spacing) { content() }
        } else {
            HStack(alignment: .top, spacing: spacing) { content() }
        }
    }
}

#Preview {
    DashboardView()
        .environment(AppState())
        .frame(width: 1100, height: 800)
}
