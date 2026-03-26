import SwiftUI

/// View model for the Dashboard — summary metrics + focused opportunities.
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

    var priorityListing: Listing? {
        filterListings.values
            .flatMap { $0 }
            .sorted { lhs, rhs in
                let lhsScore = lhs.currentScore ?? 0
                let rhsScore = rhs.currentScore ?? 0
                if lhsScore == rhsScore {
                    return lhs.firstSeenAt > rhs.firstSeenAt
                }
                return lhsScore > rhsScore
            }
            .first
    }

    var matchedFilterCount: Int {
        activeFilters.count { (filterListings[$0.id] ?? []).isEmpty == false }
    }

    // MARK: - Summary Cards

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
