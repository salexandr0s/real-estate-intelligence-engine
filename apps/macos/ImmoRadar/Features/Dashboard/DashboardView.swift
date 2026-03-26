import SwiftUI

/// Dashboard — organized investor overview with KPI cards, focus panel, and tracked filters.
struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = DashboardViewModel()

    private var summaryCards: [DashboardViewModel.SummaryCard] {
        viewModel.summaryCards(unreadAlertCount: appState.unreadAlertCount)
    }

    var body: some View {
        GeometryReader { proxy in
            let isSingleColumn = proxy.size.width < Theme.Dashboard.singleColumnBreakpoint
            let sideColumnWidth = min(max(proxy.size.width * 0.29, 320), Theme.Dashboard.sideColumnWidth)

            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Dashboard.sectionSpacing) {
                    DashboardOverviewHeader(
                        lastRefresh: viewModel.lastRefreshDate,
                        totalMatches: viewModel.totalUniqueMatches,
                        isLoading: viewModel.isLoading
                    )

                    if let error = viewModel.errorMessage {
                        DashboardErrorBanner(message: error) {
                            Task { await viewModel.refresh(using: appState.apiClient) }
                        }
                    }

                    if isSingleColumn {
                        focusPanel
                        summaryCluster
                        topOpportunitiesPanel
                        DashboardActivityPanel(snapshot: viewModel.activitySnapshot)
                        DashboardFilterCoveragePanel(
                            summary: viewModel.filterCoverageSummary,
                            rows: viewModel.filterCoverageRows,
                            onOpenFilters: { appState.navigateTo(.filters) }
                        )
                    } else {
                        VStack(spacing: Theme.Dashboard.sectionSpacing) {
                            HStack(alignment: .top, spacing: Theme.Dashboard.gridSpacing) {
                                focusPanel
                                    .frame(maxWidth: .infinity, alignment: .leading)

                                summaryCluster
                                    .frame(width: sideColumnWidth, alignment: .topLeading)
                            }

                            HStack(alignment: .top, spacing: Theme.Dashboard.gridSpacing) {
                                topOpportunitiesPanel
                                    .frame(maxWidth: .infinity, alignment: .leading)

                                DashboardActivityPanel(snapshot: viewModel.activitySnapshot)
                                    .frame(width: sideColumnWidth, alignment: .topLeading)
                            }

                            DashboardFilterCoveragePanel(
                                summary: viewModel.filterCoverageSummary,
                                rows: viewModel.filterCoverageRows,
                                onOpenFilters: { appState.navigateTo(.filters) }
                            )
                        }
                    }

                    ForYouSection(
                        activeFilters: viewModel.dashboardFilters,
                        filterListings: viewModel.filterListings,
                        filterLoadingStates: viewModel.filterLoadingStates,
                        isLoading: viewModel.isLoading,
                        onListingTap: { id in
                            appState.deepLinkListingId = id
                            appState.selectedNavItem = .listings
                        },
                        onNavigateToFilters: {
                            appState.navigateTo(.filters)
                        },
                        onNavigateToListings: {
                            appState.navigateTo(.listings)
                        }
                    )
                }
                .frame(maxWidth: Theme.Dashboard.contentMaxWidth, alignment: .leading)
                .padding(.horizontal, Theme.Spacing.xl)
                .padding(.top, Theme.Spacing.lg)
                .padding(.bottom, Theme.Spacing.xxxl)
                .frame(maxWidth: .infinity, alignment: .center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))
        }
        .navigationTitle("Dashboard")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            ToolbarItem(placement: .automatic) {
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

    private var summaryCluster: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            DashboardSectionHeader(
                title: "Market pulse",
                subtitle: "The few numbers worth scanning before you drill into listings."
            )

            SummaryStripView(
                cards: summaryCards,
                onCardNavigate: { cardId in
                    switch cardId {
                    case "active-listings", "new-this-week", "high-score":
                        appState.navigateTo(.listings)
                    case "active-filters":
                        appState.navigateTo(.filters)
                    case "unread-alerts":
                        appState.navigateTo(.alerts)
                    default:
                        break
                    }
                }
            )
        }
    }

    @ViewBuilder
    private var focusPanel: some View {
        if let priorityListing = viewModel.priorityListing {
            PriorityBriefingCard(
                listing: priorityListing,
                matchedFilterCount: viewModel.matchedFilterCount,
                totalMatches: viewModel.totalUniqueMatches,
                onOpenListing: {
                    appState.deepLinkListingId = priorityListing.id
                    appState.selectedNavItem = .listings
                },
                onOpenFilters: {
                    appState.navigateTo(.filters)
                }
            )
        } else {
            DashboardFocusEmptyCard(
                hasActiveFilters: !viewModel.dashboardFilters.isEmpty,
                totalMatches: viewModel.totalUniqueMatches,
                onOpenFilters: { appState.navigateTo(.filters) },
                onBrowseListings: { appState.navigateTo(.listings) }
            )
        }
    }

    private var topOpportunitiesPanel: some View {
        TopOpportunitiesSection(
            listings: viewModel.topOpportunities(),
            totalMatches: viewModel.totalUniqueMatches,
            onListingTap: { id in
                appState.deepLinkListingId = id
                appState.selectedNavItem = .listings
            }
        )
    }
}

private struct DashboardOverviewHeader: View {
    let lastRefresh: Date?
    let totalMatches: Int
    let isLoading: Bool

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .bottom, spacing: Theme.Spacing.lg) {
                headerCopy
                Spacer(minLength: Theme.Spacing.lg)
                headerStatus
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                headerCopy
                headerStatus
            }
        }
    }

    private var headerCopy: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text("Investor overview")
                .font(.system(size: 34, weight: .bold, design: .rounded))

            Text("A calm overview of what changed, what qualifies, and what deserves your next click.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var headerStatus: some View {
        HStack(spacing: Theme.Spacing.sm) {
            if let lastRefresh {
                DashboardStatusPill(
                    text: "Updated \(PriceFormatter.relativeDate(lastRefresh))",
                    systemImage: "clock"
                )
            }

            DashboardStatusPill(
                text: totalMatches > 0 ? "\(totalMatches) live matches" : (isLoading ? "Loading matches" : "No live matches"),
                systemImage: totalMatches > 0 ? "sparkles" : "line.3.horizontal.decrease.circle"
            )
        }
    }
}

private struct DashboardSectionHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(title)
                .font(.title3)
                .adaptiveFontWeight(.semibold)

            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

private struct DashboardStatusPill: View {
    let text: String
    let systemImage: String

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.08), in: Capsule())
    }
}

private struct PriorityBriefingCard: View {
    let listing: Listing
    let matchedFilterCount: Int
    let totalMatches: Int
    let onOpenListing: () -> Void
    let onOpenFilters: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
            HStack(alignment: .top, spacing: Theme.Spacing.xl) {
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    Text("Today’s edge")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)

                    Text(listing.title)
                        .font(.system(size: 28, weight: .semibold, design: .rounded))
                        .fixedSize(horizontal: false, vertical: true)

                    Text("Best current opportunity across your active filters, surfaced first so the dashboard answers what to inspect next.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: Theme.Spacing.lg)

                if let score = listing.currentScore {
                    ScoreIndicator(score: score, size: .large)
                }
            }

            FlowLayout(spacing: Theme.Spacing.sm) {
                DashboardMetaChip(text: PriceFormatter.format(eur: listing.listPriceEur), systemImage: "eurosign.circle")

                if let district = listing.districtName {
                    DashboardMetaChip(text: district, systemImage: "mappin")
                }

                if let area = listing.livingAreaSqm {
                    DashboardMetaChip(text: PriceFormatter.formatArea(area), systemImage: "ruler")
                }

                if let rooms = listing.rooms {
                    DashboardMetaChip(text: "\(PriceFormatter.formatRooms(rooms)) rooms", systemImage: "square.split.2x2")
                }
            }

            HStack(spacing: Theme.Spacing.sm) {
                Button("Open Listing", action: onOpenListing)
                    .buttonStyle(.borderedProminent)
                Button("Review Filters", action: onOpenFilters)
                    .buttonStyle(.bordered)
            }

            Divider()

            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.Spacing.lg) {
                    DashboardSupportingStat(
                        value: "\(matchedFilterCount)",
                        label: "Filters returning matches"
                    )
                    DashboardSupportingStat(
                        value: "\(totalMatches)",
                        label: "Unique matched listings"
                    )
                    DashboardSupportingStat(
                        value: PriceFormatter.relativeDate(listing.firstSeenAt),
                        label: "First seen"
                    )
                }

                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    DashboardSupportingStat(
                        value: "\(matchedFilterCount)",
                        label: "Filters returning matches"
                    )
                    DashboardSupportingStat(
                        value: "\(totalMatches)",
                        label: "Unique matched listings"
                    )
                    DashboardSupportingStat(
                        value: PriceFormatter.relativeDate(listing.firstSeenAt),
                        label: "First seen"
                    )
                }
            }
        }
        .dashboardPanelStyle(
            padding: Theme.Spacing.xxl,
            tint: listing.currentScore.map { Theme.scoreColor(for: $0) },
            elevated: true
        )
    }
}

private struct DashboardFocusEmptyCard: View {
    let hasActiveFilters: Bool
    let totalMatches: Int
    let onOpenFilters: () -> Void
    let onBrowseListings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
            Text(hasActiveFilters ? "Nothing compelling yet" : "Build your first investor queue")
                .font(.system(size: 26, weight: .semibold, design: .rounded))

            Text(
                hasActiveFilters
                    ? "Your filters are active, but nothing currently stands out as a dashboard priority. Review the criteria or browse the full listings view."
                    : "Create active filters so the dashboard can surface strong matches, live activity, and a clear place to start each time you open the app."
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: Theme.Spacing.sm) {
                Button(hasActiveFilters ? "Review Filters" : "Set Up Filters", action: onOpenFilters)
                    .buttonStyle(.borderedProminent)
                Button("Browse Listings", action: onBrowseListings)
                    .buttonStyle(.bordered)
            }

            if totalMatches > 0 {
                Text("\(totalMatches) matched listings are currently loaded, but none rank strongly enough to lead the overview.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .dashboardPanelStyle(padding: Theme.Spacing.xxl, tint: .blue, elevated: true)
    }
}

private struct DashboardMetaChip: View {
    let text: String
    let systemImage: String

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, 7)
            .background(Color.white.opacity(0.08), in: Capsule())
    }
}

private struct DashboardSupportingStat: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(value)
                .font(.subheadline.monospacedDigit())
                .adaptiveFontWeight(.semibold)
                .foregroundStyle(.primary)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct DashboardActivityPanel: View {
    let snapshot: DashboardViewModel.ActivitySnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            DashboardSectionHeader(
                title: "Live activity",
                subtitle: "Signals derived from the listings already loaded into the dashboard."
            )

            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    DashboardActivityMetric(title: "New 24h", value: snapshot.newListings, icon: "sparkles", color: .blue)
                    Divider()
                    DashboardActivityMetric(title: "Price drops", value: snapshot.priceDrops, icon: "arrow.down.circle", color: .green)
                }

                Divider()

                HStack(spacing: 0) {
                    DashboardActivityMetric(title: "Score 70+", value: snapshot.highScoreMatches, icon: "star.fill", color: .orange)
                    Divider()
                    DashboardActivityMetric(title: "Unique matches", value: snapshot.totalMatches, icon: "tray.full.fill", color: .purple)
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .strokeBorder(Color(nsColor: .separatorColor).opacity(0.12), lineWidth: 0.5)
            }
            .clipShape(.rect(cornerRadius: Theme.Radius.lg))
        }
        .dashboardPanelStyle(tint: .green)
    }
}

private struct DashboardActivityMetric: View {
    let title: String
    let value: Int
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Image(systemName: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)
                .frame(width: 28, height: 28)
                .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: Theme.Radius.md))

            Text("\(value)")
                .font(.title2.bold())
                .fontDesign(.rounded)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
        .padding(Theme.Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(color.opacity(0.08))
        )
    }
}

private struct DashboardFilterCoveragePanel: View {
    let summary: DashboardViewModel.FilterCoverageSummary
    let rows: [DashboardViewModel.FilterCoverageRow]
    let onOpenFilters: () -> Void

    private var maxCount: Int {
        max(rows.map(\.matchCount).max() ?? 0, 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                DashboardSectionHeader(
                    title: "Filter coverage",
                    subtitle: {
                        if summary.activeFilters == 0 {
                            return "See how well your active filters are currently populated."
                        }
                        if summary.strongestFilterCount > 0, let strongestFilterName = summary.strongestFilterName {
                            return "Strongest filter: \(strongestFilterName) (\(summary.strongestFilterCount) matches)."
                        }
                        return "All active filters are currently empty."
                    }()
                )

                Spacer(minLength: Theme.Spacing.md)

                Button("Open Filters", action: onOpenFilters)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: Theme.Spacing.xl) {
                    coverageSummary
                        .frame(width: 260, alignment: .leading)

                    Divider()

                    coverageRows
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    coverageSummary
                    Divider()
                    coverageRows
                }
            }
        }
        .dashboardPanelStyle(tint: .purple)
    }

    private var coverageSummary: some View {
        HStack(spacing: 0) {
            DashboardSupportingStat(value: "\(summary.matchedFilters)/\(summary.activeFilters)", label: "Filters with matches")
                .frame(maxWidth: .infinity, alignment: .leading)
            Divider()
            DashboardSupportingStat(value: "\(summary.emptyFilters)", label: "Filters empty")
                .frame(maxWidth: .infinity, alignment: .leading)
            Divider()
            DashboardSupportingStat(value: "\(summary.totalUniqueMatches)", label: "Unique matches")
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var coverageRows: some View {
        if rows.isEmpty {
            Text("No active filters yet.")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            VStack(spacing: Theme.Spacing.sm) {
                ForEach(rows.prefix(4)) { row in
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        HStack(spacing: Theme.Spacing.sm) {
                            Text(row.name)
                                .font(.caption)
                                .lineLimit(1)
                            Spacer(minLength: Theme.Spacing.sm)
                            if row.isLoading {
                                ProgressView()
                                    .controlSize(.mini)
                            }
                            Text("\(row.matchCount)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }

                        DashboardCoverageBar(value: Double(row.matchCount), maximum: Double(maxCount))
                    }
                }
            }
        }
    }
}

private struct DashboardCoverageBar: View {
    let value: Double
    let maximum: Double

    var body: some View {
        GeometryReader { proxy in
            let ratio = maximum > 0 ? min(value / maximum, 1) : 0

            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.secondary.opacity(0.12))
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.accentColor.opacity(0.85))
                    .frame(width: max(6, proxy.size.width * ratio))
            }
        }
        .frame(height: 6)
    }
}

#Preview {
    DashboardView()
        .environment(AppState())
        .frame(width: 1280, height: 900)
}
