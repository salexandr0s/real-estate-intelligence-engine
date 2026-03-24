import SwiftUI

/// Server-side dashboard stats returned by GET /v1/dashboard/stats.
struct DashboardStats: Codable, Sendable {
    let totalActive: Int
    let newToday: Int
    let newThisWeek: Int?
    let highScore70: Int
    let avgScore: Double?
}

/// View model for the Dashboard summary screen.
@MainActor @Observable
final class DashboardViewModel {

    // MARK: - State

    var stats: DashboardStats?
    var velocityData: [ListingVelocityPoint] = []
    var scoreDistribution: [ScoreDistributionBucket] = []
    var districtComparison: [DistrictComparison] = []
    var districtTrends: [DistrictTrendPoint] = []
    var topOpportunities: [Listing] = []
    var sources: [Source] = []
    var temperatureData: [MarketTemperaturePoint] = []
    var activeFilterCount: Int = 0
    var isLoading: Bool = false
    var errorMessage: String?
    var lastRefreshDate: Date?

    // MARK: - Computed

    var healthySources: Int {
        sources.count(where: { $0.healthStatus == .healthy })
    }

    var activeSources: Int {
        sources.count(where: { $0.isActive })
    }

    // MARK: - Load

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        async let statsTask = client.fetchDashboardStats()
        async let velocityTask = client.fetchDashboardVelocity()
        async let listingsTask = client.fetchListings(
            query: ListingQuery(minScore: 70, sortBy: "score_desc")
        )
        async let filtersTask = client.fetchFilters()
        async let sourcesTask = client.fetchSources()
        async let scoreDistTask = client.fetchScoreDistribution()
        async let districtCompTask = client.fetchDistrictComparison()
        async let trendsTask = client.fetchDistrictTrends(months: 6)
        async let tempTask = client.fetchMarketTemperature()

        do { stats = try await statsTask } catch { errorMessage = error.localizedDescription }
        do { velocityData = try await velocityTask } catch { velocityData = [] }
        do { topOpportunities = try await listingsTask } catch { topOpportunities = [] }
        do {
            let filters = try await filtersTask
            activeFilterCount = filters.count(where: { $0.isActive })
        } catch { /* keep previous */ }
        do { sources = try await sourcesTask } catch { sources = [] }
        do { scoreDistribution = try await scoreDistTask } catch { scoreDistribution = [] }
        do { districtComparison = try await districtCompTask } catch { districtComparison = [] }
        do { districtTrends = try await trendsTask } catch { districtTrends = [] }
        do { temperatureData = try await tempTask } catch { temperatureData = [] }

        if stats == nil, errorMessage != nil {
            let allListings = Listing.samples
            stats = DashboardStats(
                totalActive: allListings.count,
                newToday: allListings.count(where: { Calendar.current.isDateInToday($0.firstSeenAt) }),
                newThisWeek: nil,
                highScore70: allListings.count(where: { ($0.currentScore ?? 0) >= 70 }),
                avgScore: nil
            )
            activeFilterCount = Filter.samples.count(where: { $0.isActive })
            topOpportunities = allListings
                .filter { ($0.currentScore ?? 0) >= 70 }
                .sorted { ($0.currentScore ?? 0) > ($1.currentScore ?? 0) }
            sources = Source.samples
        }

        lastRefreshDate = .now
        isLoading = false
    }

    // MARK: - Enhanced Summary Cards

    struct Delta {
        let value: String
        let isPositive: Bool
    }

    struct EnhancedSummaryCard: Identifiable {
        let id: String
        let title: String
        let value: String
        let icon: String
        let color: Color
        let delta: Delta?
        let sparklineData: [Int]
    }

    func enhancedSummaryCards(unreadAlertCount: Int) -> [EnhancedSummaryCard] {
        let s = stats
        let sparkline = velocityData.map(\.count)

        let weekDelta: Delta? = s?.newThisWeek.map {
            Delta(value: "+\($0) this week", isPositive: $0 > 0)
        }

        let pipelineColor: Color = {
            if sources.isEmpty { return .gray }
            let worst = sources.min(by: { $0.healthStatus.sortOrder < $1.healthStatus.sortOrder })
            switch worst?.healthStatus {
            case .healthy: return .green
            case .degraded: return .orange
            case .failing: return .red
            default: return .gray
            }
        }()

        var cards: [EnhancedSummaryCard] = [
            EnhancedSummaryCard(
                id: "active-listings",
                title: "Active Listings",
                value: "\(s?.totalActive ?? 0)",
                icon: "building.2.fill",
                color: .blue,
                delta: weekDelta,
                sparklineData: sparkline
            ),
            EnhancedSummaryCard(
                id: "new-this-week",
                title: "New This Week",
                value: "\(s?.newThisWeek ?? s?.newToday ?? 0)",
                icon: "sparkles",
                color: .green,
                delta: nil,
                sparklineData: sparkline
            ),
            EnhancedSummaryCard(
                id: "high-score",
                title: "High Score (70+)",
                value: "\(s?.highScore70 ?? 0)",
                icon: "star.fill",
                color: .orange,
                delta: s?.avgScore.map { Delta(value: "Avg \(String(format: "%.0f", $0))", isPositive: $0 >= 50) },
                sparklineData: []
            ),
            EnhancedSummaryCard(
                id: "pipeline",
                title: "Pipeline",
                value: "\(healthySources)/\(activeSources)",
                icon: "antenna.radiowaves.left.and.right",
                color: pipelineColor,
                delta: nil,
                sparklineData: []
            ),
            EnhancedSummaryCard(
                id: "active-filters",
                title: "Active Filters",
                value: "\(activeFilterCount)",
                icon: "line.3.horizontal.decrease.circle.fill",
                color: .purple,
                delta: nil,
                sparklineData: []
            ),
        ]

        if unreadAlertCount > 0 {
            cards.append(EnhancedSummaryCard(
                id: "unread-alerts",
                title: "Unread Alerts",
                value: "\(unreadAlertCount)",
                icon: "bell.badge.fill",
                color: .red,
                delta: nil,
                sparklineData: []
            ))
        }

        return cards
    }
}
