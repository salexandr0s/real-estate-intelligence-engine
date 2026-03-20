import SwiftUI

/// Dashboard overview with summary cards, recent high-score listings, and source health.
struct DashboardView: View {
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
            await viewModel.refresh()
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
                Task { await viewModel.refresh() }
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
                summaryCardView(card)
            }
        }
    }

    private func summaryCardView(_ card: DashboardViewModel.SummaryCard) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Image(systemName: card.icon)
                    .font(.title3)
                    .foregroundStyle(cardColor(card.color))
                Spacer()
            }
            Text(card.value)
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundStyle(.primary)
            Text(card.title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .cardStyle()
    }

    private func cardColor(_ name: String) -> Color {
        switch name {
        case "blue": return .blue
        case "green": return .green
        case "orange": return .orange
        case "purple": return .purple
        default: return .accentColor
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
                emptyState(
                    icon: "building.2",
                    title: "No high-score listings yet",
                    subtitle: "Listings with score 60+ will appear here"
                )
            } else {
                VStack(spacing: 0) {
                    ForEach(viewModel.recentHighScoreListings) { listing in
                        dashboardListingRow(listing)
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

    private func dashboardListingRow(_ listing: Listing) -> some View {
        HStack(spacing: Theme.Spacing.md) {
            ScoreIndicator(score: listing.currentScore, size: .compact)

            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(listing.title)
                    .font(.body)
                    .lineLimit(1)
                HStack(spacing: Theme.Spacing.sm) {
                    Text(listing.districtName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("--")
                        .font(.caption)
                        .foregroundStyle(.quaternary)
                    Text(PriceFormatter.format(eur: listing.listPriceEur))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    Text("--")
                        .font(.caption)
                        .foregroundStyle(.quaternary)
                    Text(PriceFormatter.formatArea(listing.livingAreaSqm))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Text(PriceFormatter.relativeDate(listing.firstSeenAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, Theme.Spacing.sm)
        .contentShape(Rectangle())
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
                    sourceRow(source)
                    if source.id != viewModel.sources.last?.id {
                        Divider()
                    }
                }
            }
        }
        .cardStyle()
        .frame(minWidth: 300, maxWidth: 400)
    }

    private func sourceRow(_ source: Source) -> some View {
        HStack(spacing: Theme.Spacing.md) {
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(source.name)
                    .font(.body)
                if let lastRun = source.lastSuccessfulRun {
                    Text("Last run: \(PriceFormatter.relativeDate(lastRun))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            StatusBadge(healthStatus: source.healthStatus)
        }
        .padding(.vertical, Theme.Spacing.sm)
    }

    // MARK: - Empty State

    private func emptyState(icon: String, title: String, subtitle: String) -> some View {
        VStack(spacing: Theme.Spacing.md) {
            Image(systemName: icon)
                .font(.largeTitle)
                .foregroundStyle(.quaternary)
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Spacing.xxl)
    }
}

#Preview {
    DashboardView()
        .environment(AppState())
        .frame(width: 900, height: 700)
}
