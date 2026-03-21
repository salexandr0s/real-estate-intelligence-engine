import Foundation

/// View model for scraping source health monitoring.
@MainActor @Observable
final class SourcesViewModel {

    // MARK: - State

    var sources: [Source] = []
    var isLoading: Bool = false
    var errorMessage: String?

    // MARK: - Computed

    var healthyCount: Int {
        sources.count(where: { $0.healthStatus == .healthy })
    }

    var degradedCount: Int {
        sources.count(where: { $0.healthStatus == .degraded })
    }

    var failingCount: Int {
        sources.count(where: { $0.healthStatus == .failing })
    }

    var activeCount: Int {
        sources.count(where: { $0.isActive })
    }

    var totalListingsIngested: Int {
        sources.reduce(0) { $0 + $1.totalListingsIngested }
    }

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        do {
            sources = try await client.fetchSources()
        } catch {
            errorMessage = error.localizedDescription
            if sources.isEmpty {
                sources = Source.samples
            }
        }

        isLoading = false
    }
}
