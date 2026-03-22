import SwiftUI

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
            let allListings = try await client.fetchListings(query: ListingQuery())
            totalActiveListings = allListings.count
            newListingsToday = allListings.count(where: {
                Calendar.current.isDateInToday($0.firstSeenAt)
            })
            highScoreCount = allListings.count(where: { ($0.currentScore ?? 0) >= 70 })
            recentHighScoreListings = allListings
                .filter { ($0.currentScore ?? 0) >= 60 }
                .sorted { ($0.currentScore ?? 0) > ($1.currentScore ?? 0) }

            let filters = try await client.fetchFilters()
            activeFilterCount = filters.count(where: { $0.isActive })

            sources = try await client.fetchSources()

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
