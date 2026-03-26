import SwiftUI

/// View model for the Dashboard — overview metrics plus actionable investor queue.
@MainActor @Observable
final class DashboardViewModel {

    // MARK: - State

    var stats: DashboardStats?
    var activeFilters: [Filter] = []
    var filterListings: [Int: [Listing]] = [:]
    var filterLoadingStates: [Int: Bool] = [:]
    var isLoading: Bool = false
    var errorMessage: String?
    var lastRefreshDate: Date?

    // MARK: - Load

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        async let statsTask = client.fetchDashboardStats()
        async let filtersTask = client.fetchFilters()

        do { stats = try await statsTask } catch {
            errorMessage = error.localizedDescription
        }

        do {
            let allFilters = try await filtersTask
            activeFilters = allFilters.filter(\.isActive)
        } catch {
            errorMessage = errorMessage ?? error.localizedDescription
            activeFilters = []
        }

        await fetchFilterListings(using: client)

        lastRefreshDate = .now
        isLoading = false
    }

    private func fetchFilterListings(using client: APIClient) async {
        for filter in activeFilters {
            filterLoadingStates[filter.id] = true
        }

        await withTaskGroup(of: (Int, [Listing]?).self) { group in
            for filter in activeFilters {
                group.addTask { [filter] in
                    do {
                        let listings = try await client.testFilter(id: filter.id)
                        return (filter.id, listings)
                    } catch {
                        return (filter.id, nil)
                    }
                }
            }

            for await (filterId, listings) in group {
                filterListings[filterId] = listings ?? []
                filterLoadingStates[filterId] = false
            }
        }
    }

    // MARK: - Derived Models

    struct Delta {
        let value: String
        let isPositive: Bool
    }

    struct SummaryCard: Identifiable {
        let id: String
        let title: String
        let value: String
        let icon: String
        let color: Color
        let delta: Delta?
    }

    struct ActivitySnapshot {
        let newListings: Int
        let priceDrops: Int
        let highScoreMatches: Int
        let totalMatches: Int
    }

    struct FilterCoverageSummary {
        let activeFilters: Int
        let matchedFilters: Int
        let emptyFilters: Int
        let totalUniqueMatches: Int
        let strongestFilterName: String?
        let strongestFilterCount: Int
    }

    struct FilterCoverageRow: Identifiable {
        let id: Int
        let name: String
        let matchCount: Int
        let isLoading: Bool
    }

    // MARK: - Ordering + Ranking

    var dashboardFilters: [Filter] {
        activeFilters.sorted { lhs, rhs in
            let lhsCount = displayedMatchCount(for: lhs)
            let rhsCount = displayedMatchCount(for: rhs)
            if lhsCount == rhsCount {
                return lhs.updatedAt > rhs.updatedAt
            }
            return lhsCount > rhsCount
        }
    }

    private func displayedMatchCount(for filter: Filter) -> Int {
        let loadedCount = filterListings[filter.id]?.count ?? 0
        if loadedCount > 0 { return loadedCount }
        if filterLoadingStates[filter.id] == true {
            return filter.matchCount ?? 0
        }
        return loadedCount
    }

    private func isBetterOpportunity(_ lhs: Listing, than rhs: Listing) -> Bool {
        let lhsScore = lhs.currentScore ?? 0
        let rhsScore = rhs.currentScore ?? 0
        if lhsScore == rhsScore {
            return lhs.firstSeenAt > rhs.firstSeenAt
        }
        return lhsScore > rhsScore
    }

    private var uniqueMatchedListings: [Listing] {
        var deduped: [Int: Listing] = [:]

        for listing in filterListings.values.flatMap({ $0 }) {
            if let existing = deduped[listing.id] {
                deduped[listing.id] = isBetterOpportunity(listing, than: existing) ? listing : existing
            } else {
                deduped[listing.id] = listing
            }
        }

        return Array(deduped.values)
    }

    private var rankedMatchedListings: [Listing] {
        uniqueMatchedListings.sorted(by: isBetterOpportunity)
    }

    // MARK: - Helpers

    func topListingsForFilter(_ filterId: Int, limit: Int = 5) -> [Listing] {
        Array(
            (filterListings[filterId] ?? [])
                .sorted { ($0.currentScore ?? 0) > ($1.currentScore ?? 0) }
                .prefix(limit)
        )
    }

    func totalCountForFilter(_ filterId: Int) -> Int {
        filterListings[filterId]?.count ?? 0
    }

    var totalUniqueMatches: Int {
        uniqueMatchedListings.count
    }

    var priorityListing: Listing? {
        rankedMatchedListings.first
    }

    func topOpportunities(limit: Int = 6) -> [Listing] {
        Array(rankedMatchedListings.prefix(limit))
    }

    var matchedFilterCount: Int {
        activeFilters.count { (filterListings[$0.id] ?? []).isEmpty == false }
    }

    var activitySnapshot: ActivitySnapshot {
        let newListings = uniqueMatchedListings.count { listing in
            Calendar.current.dateComponents([.hour], from: listing.firstSeenAt, to: .now).hour ?? 999 < 24
        }

        let priceDrops = uniqueMatchedListings.count { listing in
            guard let pct = listing.lastPriceChangePct, pct < 0 else { return false }
            guard let changedAt = listing.lastPriceChangeAt else { return true }
            return changedAt >= Calendar.current.date(byAdding: .day, value: -7, to: .now) ?? .distantPast
        }

        let highScoreMatches = uniqueMatchedListings.count { ($0.currentScore ?? 0) >= 70 }

        return ActivitySnapshot(
            newListings: newListings,
            priceDrops: priceDrops,
            highScoreMatches: highScoreMatches,
            totalMatches: totalUniqueMatches
        )
    }

    var filterCoverageSummary: FilterCoverageSummary {
        let strongest = dashboardFilters.max { displayedMatchCount(for: $0) < displayedMatchCount(for: $1) }
        let strongestCount = strongest.map(displayedMatchCount(for:)) ?? 0

        return FilterCoverageSummary(
            activeFilters: activeFilters.count,
            matchedFilters: matchedFilterCount,
            emptyFilters: max(activeFilters.count - matchedFilterCount, 0),
            totalUniqueMatches: totalUniqueMatches,
            strongestFilterName: strongest?.name,
            strongestFilterCount: strongestCount
        )
    }

    var filterCoverageRows: [FilterCoverageRow] {
        dashboardFilters.map { filter in
            FilterCoverageRow(
                id: filter.id,
                name: filter.name,
                matchCount: displayedMatchCount(for: filter),
                isLoading: filterLoadingStates[filter.id] ?? false
            )
        }
    }

    // MARK: - Summary Cards

    func summaryCards(unreadAlertCount: Int) -> [SummaryCard] {
        let s = stats

        let weekDelta: Delta? = s?.newThisWeek.map {
            Delta(value: "+\($0) this week", isPositive: $0 > 0)
        }

        var cards: [SummaryCard] = [
            SummaryCard(
                id: "active-listings",
                title: "Active Listings",
                value: "\(s?.totalActive ?? 0)",
                icon: "building.2.fill",
                color: .blue,
                delta: weekDelta
            ),
            SummaryCard(
                id: "new-this-week",
                title: "New This Week",
                value: "\(s?.newThisWeek ?? s?.newToday ?? 0)",
                icon: "sparkles",
                color: .green,
                delta: nil
            ),
            SummaryCard(
                id: "high-score",
                title: "High Score (70+)",
                value: "\(s?.highScore70 ?? 0)",
                icon: "star.fill",
                color: .orange,
                delta: s?.avgScore.map {
                    Delta(
                        value: "Avg \($0.formatted(.number.precision(.fractionLength(0))))",
                        isPositive: $0 >= 50
                    )
                }
            ),
            SummaryCard(
                id: "active-filters",
                title: "Active Filters",
                value: "\(activeFilters.count)",
                icon: "line.3.horizontal.decrease.circle.fill",
                color: .purple,
                delta: matchedFilterCount > 0
                    ? Delta(value: "\(matchedFilterCount) with matches", isPositive: true)
                    : nil
            ),
        ]

        if unreadAlertCount > 0 {
            cards.append(SummaryCard(
                id: "unread-alerts",
                title: "Unread Alerts",
                value: "\(unreadAlertCount)",
                icon: "bell.badge.fill",
                color: .red,
                delta: nil
            ))
        }

        return cards
    }
}
