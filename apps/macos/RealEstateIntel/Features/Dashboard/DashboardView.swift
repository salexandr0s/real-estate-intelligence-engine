import SwiftUI

/// Dashboard overview with summary cards, recent high-score listings, and source health.
struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = DashboardViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                header
                summaryGrid
                HStack(alignment: .top, spacing: Theme.Spacing.xl) {
                    recentListingsSection
                    sourceHealthSection
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

    // MARK: - Header

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Text("Dashboard")
                    .font(.largeTitle.bold())
                Text("Real estate market intelligence overview")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { await viewModel.refresh(using: appState.apiClient) }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .disabled(viewModel.isLoading)
        }
    }

    // MARK: - Summary Cards

    private var summaryGrid: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: Theme.Spacing.lg),
                GridItem(.flexible(), spacing: Theme.Spacing.lg),
                GridItem(.flexible(), spacing: Theme.Spacing.lg),
                GridItem(.flexible(), spacing: Theme.Spacing.lg),
            ],
            spacing: Theme.Spacing.lg
        ) {
            ForEach(viewModel.summaryCards) { card in
                SummaryCardView(card: card)
            }
        }
    }

    // MARK: - Recent High-Score Listings

    private var recentListingsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Label("Recent High-Score Listings", systemImage: "star.fill")
                    .font(.headline)
                Spacer()
                Text("\(viewModel.recentHighScoreListings.count) listings")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if viewModel.recentHighScoreListings.isEmpty {
                ContentUnavailableView {
                    Label("No high-score listings yet", systemImage: "building.2")
                } description: {
                    Text("Listings with score 60+ will appear here")
                }
            } else {
                VStack(spacing: 0) {
                    ForEach(viewModel.recentHighScoreListings) { listing in
                        DashboardListingRow(listing: listing)
                        if listing.id != viewModel.recentHighScoreListings.last?.id {
                            Divider()
                                .padding(.leading, 52)
                        }
                    }
                }
            }
        }
        .cardStyle()
        .frame(maxWidth: .infinity)
    }

    // MARK: - Source Health

    private var sourceHealthSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Label("Source Health", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.headline)
                Spacer()
                Text("\(viewModel.healthySources)/\(viewModel.activeSources) healthy")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 0) {
                ForEach(viewModel.sources, id: \.id) { source in
                    SourceHealthRow(source: source)
                    if source.id != viewModel.sources.last?.id {
                        Divider()
                    }
                }
            }
        }
        .cardStyle()
        .frame(minWidth: 300, maxWidth: 400)
    }
}

#Preview {
    DashboardView()
        .environment(AppState())
        .frame(width: 900, height: 700)
}
