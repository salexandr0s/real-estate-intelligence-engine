import SwiftUI

/// Server-side dashboard stats returned by GET /v1/dashboard/stats.
struct DashboardStats: Codable, Sendable {
    let totalActive: Int
    let newToday: Int
    let highScore70: Int
}

/// View model for the Dashboard summary screen.
@MainActor @Observable
final class DashboardViewModel {

    // MARK: - State

    var totalActiveListings: Int = 0
    var newListingsToday: Int = 0
    var highScoreCount: Int = 0
    var activeFilterCount: Int = 0
    var recentHighScoreListings: [Listing] = []
    var sources: [Source] = []
    var temperatureData: [MarketTemperaturePoint] = []
    var isLoading: Bool = false
    var errorMessage: String?

    // MARK: - Computed

    var healthySources: Int {
        sources.count(where: { $0.healthStatus == .healthy })
    }

    var totalSources: Int {
        sources.count
    }

    var activeSources: Int {
        sources.count(where: { $0.isActive })
    }

    // MARK: - Load

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        do {
            // Fetch stats, high-score listings, filters, sources in parallel
            async let statsTask = client.fetchDashboardStats()
            async let listingsTask = client.fetchListings(
                query: ListingQuery(minScore: 60, sortBy: "score_desc")
            )
            async let filtersTask = client.fetchFilters()
            async let sourcesTask = client.fetchSources()

            let stats = try await statsTask
            totalActiveListings = stats.totalActive
            newListingsToday = stats.newToday
            highScoreCount = stats.highScore70

            recentHighScoreListings = try await listingsTask

            let filters = try await filtersTask
            activeFilterCount = filters.count(where: { $0.isActive })

            sources = try await sourcesTask

            do {
                temperatureData = try await client.fetchMarketTemperature()
            } catch {
                temperatureData = []
            }
        } catch {
            errorMessage = error.localizedDescription
            // Fall back to mock data if API unavailable
            if totalActiveListings == 0 {
                let allListings = Listing.samples
                totalActiveListings = allListings.count
                newListingsToday = allListings.count(where: {
                    Calendar.current.isDateInToday($0.firstSeenAt)
                })
                highScoreCount = allListings.count(where: { ($0.currentScore ?? 0) >= 70 })
                activeFilterCount = Filter.samples.count(where: { $0.isActive })
                recentHighScoreListings = allListings
                    .filter { ($0.currentScore ?? 0) >= 60 }
                    .sorted { ($0.currentScore ?? 0) > ($1.currentScore ?? 0) }
                sources = Source.samples
            }
        }

        isLoading = false
    }

    // MARK: - Summary Cards

    struct SummaryCard: Identifiable {
        let id: String
        let title: String
        let value: String
        let icon: String
        let color: Color
    }

    var summaryCards: [SummaryCard] {
        [
            SummaryCard(
                id: "active-listings",
                title: "Active Listings",
                value: "\(totalActiveListings)",
                icon: "building.2.fill",
                color: .blue
            ),
            SummaryCard(
                id: "new-today",
                title: "New Today",
                value: "\(newListingsToday)",
                icon: "sparkles",
                color: .green
            ),
            SummaryCard(
                id: "high-score",
                title: "High Score (70+)",
                value: "\(highScoreCount)",
                icon: "star.fill",
                color: .orange
            ),
            SummaryCard(
                id: "active-filters",
                title: "Active Filters",
                value: "\(activeFilterCount)",
                icon: "line.3.horizontal.decrease.circle.fill",
                color: .purple
            ),
        ]
    }
}
