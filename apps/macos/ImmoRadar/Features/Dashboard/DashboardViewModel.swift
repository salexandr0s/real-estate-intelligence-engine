import SwiftUI

/// View model for the Dashboard — overview metrics plus actionable investor queue.
@MainActor @Observable
final class DashboardViewModel {

    // MARK: - State

    /// The last stats loaded. A failed refresh keeps them.
    var stats: DashboardStats?
    /// The last active filters loaded. A failed refresh keeps them.
    var activeFilters: [Filter] = []
    /// The last matches loaded per active filter. A filter is missing until its matches load once.
    var filterListings: [Int: [Listing]] = [:]
    var filterLoadingStates: [Int: Bool] = [:]
    var isLoading: Bool = false
    var errorMessage: String?
    /// When a refresh last loaded everything without an error.
    var lastRefreshDate: Date?
    /// False until a refresh loads the filter list. Until then the view shows a loading or error
    /// state, because empty filter sections would read as real zeros.
    private(set) var hasLoaded = false

    /// Goes up with each refresh, so a slower earlier refresh can't overwrite a newer one.
    @ObservationIgnored private var latestRefreshID = 0

    // MARK: - Load

    func refresh(using client: APIClient) async {
        latestRefreshID += 1
        let refreshID = latestRefreshID
        isLoading = true
        errorMessage = nil

        async let statsTask = client.fetchDashboardStats()
        async let filtersTask = client.fetchFilters()

        var failure: Error?

        do {
            let loadedStats = try await statsTask
            if refreshID == latestRefreshID {
                stats = loadedStats
            }
        } catch {
            failure = error
        }

        var loadedFilters: [Filter]?
        do {
            loadedFilters = try await filtersTask
        } catch {
            failure = failure ?? error
        }

        guard refreshID == latestRefreshID else { return }

        // Without a new filter list, the filters and matches loaded before stay as they are.
        if let loadedFilters {
            setActiveFilters(loadedFilters.filter(\.isActive))
            if let matchFailure = await fetchFilterListings(using: client, refreshID: refreshID) {
                failure = failure ?? matchFailure
            }
            guard refreshID == latestRefreshID else { return }
            hasLoaded = true
        }

        if let failure {
            errorMessage = AppErrorPresentation.message(for: failure)
        } else {
            lastRefreshDate = .now
        }
        isLoading = false
    }

    /// Replaces the active filters and drops the matches of filters that are no longer active.
    private func setActiveFilters(_ filters: [Filter]) {
        activeFilters = filters
        let activeIDs = Set(filters.map(\.id))
        filterListings = filterListings.filter { activeIDs.contains($0.key) }
        filterLoadingStates = filterLoadingStates.filter { activeIDs.contains($0.key) }
    }

    /// Loads each active filter's matches and returns the first failure. A filter whose load fails
    /// keeps the matches loaded before, or has none, which the view shows as unavailable.
    private func fetchFilterListings(using client: APIClient, refreshID: Int) async -> Error? {
        let filterIDs = activeFilters.map(\.id)
        for filterID in filterIDs {
            filterLoadingStates[filterID] = true
        }

        var firstFailure: Error?
        await withTaskGroup(of: (Int, Result<[Listing], Error>).self) { group in
            for filterID in filterIDs {
                group.addTask {
                    do {
                        return (filterID, .success(try await client.testFilter(id: filterID)))
                    } catch {
                        return (filterID, .failure(error))
                    }
                }
            }

            for await (filterID, result) in group {
                guard refreshID == latestRefreshID else { continue }
                switch result {
                case .success(let listings):
                    filterListings[filterID] = listings
                case .failure(let error):
                    firstFailure = firstFailure ?? error
                }
                filterLoadingStates[filterID] = false
            }
        }
        return firstFailure
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
        let tone: Theme.Dashboard.SemanticTone
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
        /// Active filters whose matches failed to load and none were loaded before.
        let unavailableFilters: Int
        /// Nil while an active filter's matches are missing.
        let totalUniqueMatches: Int?
        let strongestFilterName: String?
        let strongestFilterCount: Int
    }

    struct FilterCoverageRow: Identifiable {
        let id: Int
        let name: String
        /// Nil until the filter's matches have loaded.
        let matchCount: Int?
        let isLoading: Bool
    }

    // MARK: - Ordering + Ranking

    var dashboardFilters: [Filter] {
        activeFilters.sorted { lhs, rhs in
            let lhsCount = displayedMatchCount(for: lhs)
            let rhsCount = displayedMatchCount(for: rhs)
            if lhsCount == rhsCount {
                return lhs.updatedAtSortDate > rhs.updatedAtSortDate
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
            return lhs.firstSeenSortDate > rhs.firstSeenSortDate
        }
        return lhsScore > rhsScore
    }

    /// Whether an active filter's matches failed to load and none were loaded before.
    func matchesUnavailable(for filterID: Int) -> Bool {
        filterListings[filterID] == nil && filterLoadingStates[filterID] != true
    }

    /// Active filters whose matches failed to load and none were loaded before.
    var unavailableMatchFilterCount: Int {
        activeFilters.count { matchesUnavailable(for: $0.id) }
    }

    /// Whether an active filter has no matches loaded yet. Counts over matches would leave it out,
    /// so they show as unknown instead.
    private var isMissingMatches: Bool {
        activeFilters.contains { filterListings[$0.id] == nil }
    }

    /// The unique matches across active filters, or nil while a filter's matches are missing.
    var knownUniqueMatchCount: Int? {
        isMissingMatches ? nil : totalUniqueMatches
    }

    private var uniqueMatchedListings: [Listing] {
        var deduped: [Int: Listing] = [:]

        for listing in activeFilters.flatMap({ filterListings[$0.id] ?? [] }) {
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

    /// Activity across the loaded matches, or nil while an active filter's matches are missing.
    var activitySnapshot: ActivitySnapshot? {
        guard !isMissingMatches else { return nil }

        let newListings = uniqueMatchedListings.count { listing in
            listing.wasSeenWithinLast24Hours
        }

        // Only the loaded matches, the first page of each active filter, carry price changes, so
        // the tile says it counts top matches. A drop without a date can't be placed in the week.
        let weekAgo = Calendar.current.date(byAdding: .day, value: -7, to: .now) ?? .distantPast
        let priceDrops = uniqueMatchedListings.count { listing in
            guard let pct = listing.lastPriceChangePct, pct < 0,
                  let changedAt = listing.lastPriceChangeAt else { return false }
            return changedAt >= weekAgo
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
            // A filter whose matches didn't load isn't known to be empty.
            emptyFilters: activeFilters.count { filterListings[$0.id]?.isEmpty == true },
            unavailableFilters: unavailableMatchFilterCount,
            totalUniqueMatches: knownUniqueMatchCount,
            strongestFilterName: strongest?.name,
            strongestFilterCount: strongestCount
        )
    }

    var filterCoverageRows: [FilterCoverageRow] {
        dashboardFilters.map { filter in
            FilterCoverageRow(
                id: filter.id,
                name: filter.name,
                matchCount: filterListings[filter.id]?.count,
                isLoading: filterLoadingStates[filter.id] ?? false
            )
        }
    }

    // MARK: - Summary Cards

    /// The overview cards. `unreadAlertCount` is nil until the server reports it.
    func summaryCards(unreadAlertCount: Int?) -> [SummaryCard] {
        let s = stats

        let weekDelta: Delta? = s?.newThisWeek.map {
            Delta(value: "+\($0) this week", isPositive: $0 > 0)
        }

        // Without a loaded count a card shows a dash, never a zero that reads as a real count.
        var cards: [SummaryCard] = [
            SummaryCard(
                id: "active-listings",
                title: "Active Listings",
                value: s.map { "\($0.totalActive)" } ?? "—",
                icon: "building.2.fill",
                tone: .neutral,
                delta: weekDelta
            ),
            SummaryCard(
                id: "new-this-week",
                title: "New This Week",
                value: s.map { "\($0.newThisWeek ?? $0.newToday)" } ?? "—",
                icon: "sparkles",
                tone: .accent,
                delta: nil
            ),
            SummaryCard(
                id: "high-score",
                title: "High Score (70+)",
                value: s.map { "\($0.highScore70)" } ?? "—",
                icon: "star.fill",
                tone: .score,
                delta: s?.avgScore.map {
                    Delta(
                        value: "Avg \($0.formatted(.number.precision(.fractionLength(0))))",
                        isPositive: $0 >= 50
                    )
                }
            ),
        ]

        cards.append(SummaryCard(
            id: "unread-alerts",
            title: "Unread Alerts",
            value: unreadAlertCount.map { "\($0)" } ?? "—",
            icon: "bell.badge.fill",
            tone: (unreadAlertCount ?? 0) > 0 ? .alert : .neutral,
            delta: nil
        ))

        return cards
    }
}
