import SwiftUI

private enum DashboardLayoutMode {
    case compact
    case medium
    case expanded
}

/// Dashboard — a calm briefing page that answers what deserves the next click.
struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = DashboardViewModel()

    private var summaryCards: [DashboardViewModel.SummaryCard] {
        viewModel.summaryCards(unreadAlertCount: appState.unreadAlertCount)
    }

    var body: some View {
        GeometryReader { proxy in
            let layoutMode = layoutMode(for: proxy.size.width)

            DashboardContent(
                viewModel: viewModel,
                appState: appState,
                layoutMode: layoutMode,
                summaryCards: summaryCards,
                focusPanel: focusPanel
            )
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
            guard appState.allowsAutomaticFeatureLoads else { return }
            await viewModel.refresh(using: appState.apiClient)
        }
    }

    private func layoutMode(for width: CGFloat) -> DashboardLayoutMode {
        if width < Theme.Dashboard.compactBreakpoint {
            return .compact
        }

        if width < Theme.Dashboard.mediumBreakpoint {
            return .medium
        }

        return .expanded
    }

    @ViewBuilder
    private var focusPanel: some View {
        if let priorityListing = viewModel.priorityListing {
            PriorityBriefingCard(
                listing: priorityListing,
                matchedFilterCount: viewModel.matchedFilterCount,
                totalMatches: viewModel.totalUniqueMatches,
                onOpenListing: {
                    appState.openListing(priorityListing.id)
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

}

private struct DashboardContent<FocusPanel: View>: View {
    let viewModel: DashboardViewModel
    let appState: AppState
    let layoutMode: DashboardLayoutMode
    let summaryCards: [DashboardViewModel.SummaryCard]
    let focusPanel: FocusPanel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Dashboard.sectionSpacing) {
                DashboardOverviewHeader(
                    lastRefresh: viewModel.lastRefreshDate,
                    totalMatches: viewModel.totalUniqueMatches,
                    isLoading: viewModel.isLoading
                )

                if let error = viewModel.errorMessage,
                   !AppErrorPresentation.isConnectionIssue(message: error) {
                    InlineWarningBanner(
                        title: "Couldn’t load the dashboard.",
                        message: error,
                        actions: [
                            .init("Retry", systemImage: "arrow.clockwise", isProminent: true) {
                                Task { await viewModel.refresh(using: appState.apiClient) }
                            },
                        ]
                    )
                }

                focusPanel
                opportunitiesAndSignals

                DashboardFilterCoveragePanel(
                    summary: viewModel.filterCoverageSummary,
                    rows: viewModel.filterCoverageRows,
                    onOpenFilters: { appState.navigateTo(.filters) }
                )

                ForYouSection(
                    activeFilters: Array(viewModel.dashboardFilters.prefix(4)),
                    totalActiveFilterCount: viewModel.dashboardFilters.count,
                    filterListings: viewModel.filterListings,
                    filterLoadingStates: viewModel.filterLoadingStates,
                    isLoading: viewModel.isLoading,
                    onListingTap: { id in
                        appState.openListing(id)
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
    }

    @ViewBuilder
    private var opportunitiesAndSignals: some View {
        if layoutMode == .expanded {
            HStack(alignment: .top, spacing: Theme.Dashboard.gridSpacing) {
                topOpportunitiesSection(limit: 5)
                    .frame(maxWidth: .infinity, minHeight: Theme.Dashboard.secondaryRowMinHeight, alignment: .topLeading)
                    .layoutPriority(1)

                signalsPanel
                    .frame(width: Theme.Dashboard.sideColumnWidth, alignment: .topLeading)
            }
        } else {
            topOpportunitiesSection(limit: 4)
            signalsPanel
        }
    }

    private func topOpportunitiesSection(limit: Int) -> some View {
        TopOpportunitiesSection(
            listings: viewModel.topOpportunities(limit: limit),
            totalMatches: viewModel.totalUniqueMatches,
            onListingTap: { id in
                appState.openListing(id)
            }
        )
    }

    private var signalsPanel: some View {
        DashboardSignalsPanel(
            cards: summaryCards,
            snapshot: viewModel.activitySnapshot,
            onCardNavigate: { cardId in
                switch cardId {
                case "active-listings", "new-this-week", "high-score":
                    appState.navigateTo(.listings)
                case "unread-alerts":
                    appState.navigateTo(.alerts)
                default:
                    break
                }
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
                .font(.title2)
                .adaptiveFontWeight(.semibold)
                .fontDesign(.rounded)

            Text("A calm overview of what changed, what qualifies, and what deserves your next click.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var headerStatus: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Theme.Spacing.sm) {
                statusPills
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                statusPills
            }
        }
    }

    @ViewBuilder
    private var statusPills: some View {
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
                        .font(.title2)
                        .fontDesign(.rounded)
                        .adaptiveFontWeight(.semibold)
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
            tone: .neutral,
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
                .font(.title2)
                .fontDesign(.rounded)
                .adaptiveFontWeight(.semibold)

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
        .dashboardPanelStyle(padding: Theme.Spacing.xxl, tone: .neutral, elevated: true)
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
            .background(Color.secondary.opacity(0.08), in: Capsule())
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

private struct DashboardSignalsPanel: View {
    let cards: [DashboardViewModel.SummaryCard]
    let snapshot: DashboardViewModel.ActivitySnapshot
    var onCardNavigate: ((String) -> Void)?

    private let columns = [
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            DashboardSectionHeader(
                title: "Briefing signals",
                subtitle: "Supporting context on what changed since you last looked."
            )

            SummaryStripView(cards: cards, onCardNavigate: onCardNavigate)

            Divider()

            LazyVGrid(columns: columns, spacing: Theme.Spacing.md) {
                DashboardActivityMetric(title: "New 24h", value: snapshot.newListings, icon: "sparkles", tone: .accent)
                DashboardActivityMetric(title: "Price drops", value: snapshot.priceDrops, icon: "arrow.down.circle", tone: .alert)
                DashboardActivityMetric(title: "Score 70+", value: snapshot.highScoreMatches, icon: "star.fill", tone: .score)
                DashboardActivityMetric(title: "Unique matches", value: snapshot.totalMatches, icon: "tray.full.fill", tone: .neutral)
            }
        }
        .dashboardPanelStyle(tone: .neutral)
    }
}

private struct DashboardActivityMetric: View {
    let title: String
    let value: Int
    let icon: String
    let tone: Theme.Dashboard.SemanticTone

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top) {
                Image(systemName: icon)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.Dashboard.iconTint(for: tone))
                    .frame(width: 24, height: 24)
                    .background(Theme.Dashboard.iconChipBackground(for: tone), in: RoundedRectangle(cornerRadius: Theme.Radius.md))

                Spacer(minLength: 0)
            }

            Text(value.formatted())
                .font(.title3)
                .bold()
                .fontDesign(.rounded)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(Theme.cardBackground)
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                        .strokeBorder(Theme.Dashboard.panelBorderColor(for: tone), lineWidth: 0.5)
                }
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

            coverageSummary
            coverageRows
        }
        .dashboardPanelStyle(tone: .neutral)
    }

    private var coverageSummary: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text(summarySentence)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.Spacing.xl) {
                    DashboardSupportingStat(value: "\(summary.activeFilters)", label: "Active filters")
                    DashboardSupportingStat(value: "\(summary.matchedFilters)", label: "With matches")
                    DashboardSupportingStat(value: "\(summary.emptyFilters)", label: "Empty")
                    DashboardSupportingStat(value: "\(summary.totalUniqueMatches)", label: "Unique matches")
                }

                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    DashboardSupportingStat(value: "\(summary.activeFilters)", label: "Active filters")
                    DashboardSupportingStat(value: "\(summary.matchedFilters)", label: "With matches")
                    DashboardSupportingStat(value: "\(summary.emptyFilters)", label: "Empty")
                    DashboardSupportingStat(value: "\(summary.totalUniqueMatches)", label: "Unique matches")
                }
            }
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
                ForEach(rows.prefix(3)) { row in
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        HStack(spacing: Theme.Spacing.sm) {
                            Text(row.name)
                                .font(.caption)
                                .adaptiveFontWeight(.medium)
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
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.vertical, Theme.Spacing.sm)
                    .background(Theme.Dashboard.tileBackground(for: .neutral), in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                }
            }
        }
    }

    private var summarySentence: String {
        if summary.activeFilters == 0 {
            return "No active filters yet. Create filters to turn the dashboard into a real investor briefing."
        }
        if let strongestFilterName = summary.strongestFilterName, summary.strongestFilterCount > 0 {
            return "\(summary.matchedFilters) of \(summary.activeFilters) active filters are returning matches. Strongest filter: \(strongestFilterName) with \(summary.strongestFilterCount) matches."
        }
        return "You have \(summary.activeFilters) active filters, but none are currently returning matches."
    }
}

private struct DashboardCoverageStatCard: View {
    let value: String
    let label: String
    let tone: Theme.Dashboard.SemanticTone

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(spacing: Theme.Spacing.xs) {
                Circle()
                    .fill(Theme.Dashboard.iconTint(for: tone))
                    .frame(width: 6, height: 6)
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(value)
                .font(.title2.bold())
                .fontDesign(.rounded)
        }
        .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
        .padding(Theme.Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(Theme.cardBackground)
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                        .strokeBorder(Theme.Dashboard.panelBorderColor(for: tone), lineWidth: 0.5)
                }
        )
    }
}

private struct DashboardCoverageBar: View {
    let value: Double
    let maximum: Double

    var body: some View {
        GeometryReader { proxy in
            let ratio = maximum > 0 ? min(value / maximum, 1) : 0

            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.secondary.opacity(0.10))
                RoundedRectangle(cornerRadius: 4)
                    .fill(Theme.Dashboard.iconTint(for: .accent).opacity(0.85))
                    .frame(width: ratio == 0 ? 0 : max(8, proxy.size.width * ratio))
            }
        }
        .frame(height: 8)
    }
}

#Preview {
    DashboardView()
        .environment(AppState())
        .frame(width: 1280, height: 900)
}
