import Foundation

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
    var isLoading: Bool = false
    var errorMessage: String?

    // MARK: - Computed

    var healthySources: Int {
        sources.filter { $0.healthStatus == .healthy }.count
    }

    var totalSources: Int {
        sources.count
    }

    var activeSources: Int {
        sources.filter { $0.isActive }.count
    }

    // MARK: - Load

    func loadMockData() {
        let allListings = Listing.samples
        totalActiveListings = allListings.count
        newListingsToday = allListings.filter {
            Calendar.current.isDateInToday($0.firstSeenAt)
        }.count
        highScoreCount = allListings.filter { $0.currentScore >= 70 }.count
        activeFilterCount = Filter.samples.filter { $0.isActive }.count
        recentHighScoreListings = allListings
            .filter { $0.currentScore >= 60 }
            .sorted { $0.currentScore > $1.currentScore }
        sources = Source.samples
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil

        // Use mock data for now; replace with API calls when backend is live
        try? await Task.sleep(for: .milliseconds(300))
        loadMockData()

        isLoading = false
    }

    // MARK: - Summary Cards

    struct SummaryCard: Identifiable {
        let id: String
        let title: String
        let value: String
        let icon: String
        let color: String
    }

    var summaryCards: [SummaryCard] {
        [
            SummaryCard(
                id: "active-listings",
                title: "Active Listings",
                value: "\(totalActiveListings)",
                icon: "building.2.fill",
                color: "blue"
            ),
            SummaryCard(
                id: "new-today",
                title: "New Today",
                value: "\(newListingsToday)",
                icon: "sparkles",
                color: "green"
            ),
            SummaryCard(
                id: "high-score",
                title: "High Score (70+)",
                value: "\(highScoreCount)",
                icon: "star.fill",
                color: "orange"
            ),
            SummaryCard(
                id: "active-filters",
                title: "Active Filters",
                value: "\(activeFilterCount)",
                icon: "line.3.horizontal.decrease.circle.fill",
                color: "purple"
            ),
        ]
    }
}
