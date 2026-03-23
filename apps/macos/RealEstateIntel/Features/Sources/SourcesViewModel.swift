import Foundation

/// View model for scraping source health monitoring.
@MainActor @Observable
final class SourcesViewModel {

    // MARK: - State

    var sources: [Source] = []
    var isLoading: Bool = false
    var errorMessage: String?

    /// Tracks which source IDs currently have a manual scrape in progress.
    var runningSourceIDs: Set<Int> = []

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

    var allPaused: Bool {
        !sources.isEmpty && sources.allSatisfy { !$0.isActive }
    }

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        do {
            sources = try await client.fetchSources()
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func toggleActive(_ source: Source, using client: APIClient) async {
        guard let index = sources.firstIndex(where: { $0.id == source.id }) else { return }
        let newActive = !sources[index].isActive
        sources[index].isActive = newActive
        do {
            try await client.updateSource(id: source.id, isActive: newActive)
        } catch {
            if let idx = sources.firstIndex(where: { $0.id == source.id }) {
                sources[idx].isActive = !newActive
            }
            errorMessage = error.localizedDescription
        }
    }

    func togglePauseAll(using client: APIClient) async {
        let shouldPause = !allPaused
        let backup = sources.map { $0.isActive }
        for i in sources.indices { sources[i].isActive = !shouldPause }
        do {
            if shouldPause {
                try await client.pauseAllSources()
            } else {
                try await client.resumeAllSources()
            }
        } catch {
            for i in sources.indices where i < backup.count {
                sources[i].isActive = backup[i]
            }
            errorMessage = error.localizedDescription
        }
    }

    func updateInterval(_ source: Source, minutes: Int, using client: APIClient) async {
        guard let index = sources.firstIndex(where: { $0.id == source.id }) else { return }
        let previous = sources[index].crawlIntervalMinutes
        sources[index].crawlIntervalMinutes = minutes
        do {
            try await client.updateSource(id: source.id, crawlIntervalMinutes: minutes)
        } catch {
            if let idx = sources.firstIndex(where: { $0.id == source.id }) {
                sources[idx].crawlIntervalMinutes = previous
            }
            errorMessage = error.localizedDescription
        }
    }

    func triggerRun(_ source: Source, using client: APIClient) async {
        guard !runningSourceIDs.contains(source.id) else { return }
        runningSourceIDs.insert(source.id)
        do {
            try await client.triggerScrapeRun(sourceCode: source.code)
        } catch {
            errorMessage = error.localizedDescription
        }
        runningSourceIDs.remove(source.id)
    }
}
