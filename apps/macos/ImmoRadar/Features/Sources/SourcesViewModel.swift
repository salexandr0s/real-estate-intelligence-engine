import Foundation

/// View model for scraping source health monitoring.
@MainActor @Observable
final class SourcesViewModel {
    struct LifecycleOpsRow: Identifiable {
        let id: Int
        let sourceName: String
        let explicitDead24h: Int
        let explicitDead7d: Int
        let staleExpired24h: Int
        let staleExpired7d: Int
        let lastExplicitDeadAt: Date?
        let lastStaleExpiredAt: Date?
    }

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

    var blockedCount: Int {
        sources.count(where: { $0.healthStatus == .blocked })
    }

    var attentionCount: Int {
        sources.count(where: { $0.healthStatus == .blocked || $0.healthStatus == .degraded })
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

    var needsAttentionSources: [Source] {
        sources
            .filter { $0.isActive && ($0.healthStatus == .blocked || $0.healthStatus == .degraded) }
            .sorted(by: sourceSort)
    }

    var unknownSources: [Source] {
        sources
            .filter { $0.isActive && $0.healthStatus == .unknown }
            .sorted(by: sourceSort)
    }

    var healthySources: [Source] {
        sources
            .filter { $0.isActive && $0.healthStatus == .healthy }
            .sorted(by: sourceSort)
    }

    var pausedSources: [Source] {
        sources
            .filter { !$0.isActive }
            .sorted(by: sourceSort)
    }

    var lifecycleOpsRows: [LifecycleOpsRow] {
        sources
            .map { source in
                let summary = source.lifecycleSummary
                return LifecycleOpsRow(
                    id: source.id,
                    sourceName: source.name,
                    explicitDead24h: summary?.explicitDead24h ?? 0,
                    explicitDead7d: summary?.explicitDead7d ?? 0,
                    staleExpired24h: summary?.staleExpired24h ?? 0,
                    staleExpired7d: summary?.staleExpired7d ?? 0,
                    lastExplicitDeadAt: summary?.lastExplicitDeadAt,
                    lastStaleExpiredAt: summary?.lastStaleExpiredAt
                )
            }
            .sorted(by: lifecycleOpsSort)
    }

    var hasLifecycleOpsActivity: Bool {
        lifecycleOpsRows.contains { row in
            row.explicitDead7d > 0 || row.staleExpired7d > 0
        }
    }

    var lifecycleOpsExplicit24hTotal: Int {
        lifecycleOpsRows.reduce(0) { $0 + $1.explicitDead24h }
    }

    var lifecycleOpsStale24hTotal: Int {
        lifecycleOpsRows.reduce(0) { $0 + $1.staleExpired24h }
    }

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        do {
            sources = try await client.fetchSources()
            sources.sort(by: sourceSort)
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
        }

        isLoading = false
    }

    func clearError() {
        errorMessage = nil
    }

    func toggleActive(_ source: Source, using client: APIClient) async {
        guard let index = sources.firstIndex(where: { $0.id == source.id }) else { return }
        let newActive = !sources[index].isActive
        sources[index].isActive = newActive
        do {
            try await client.updateSource(id: source.id, isActive: newActive)
            sources.sort(by: sourceSort)
        } catch {
            if let idx = sources.firstIndex(where: { $0.id == source.id }) {
                sources[idx].isActive = !newActive
            }
            errorMessage = AppErrorPresentation.message(for: error)
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
            sources.sort(by: sourceSort)
        } catch {
            for i in sources.indices where i < backup.count {
                sources[i].isActive = backup[i]
            }
            errorMessage = AppErrorPresentation.message(for: error)
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
            errorMessage = AppErrorPresentation.message(for: error)
        }
    }

    func triggerRun(_ source: Source, using client: APIClient) async {
        guard !runningSourceIDs.contains(source.id) else { return }
        runningSourceIDs.insert(source.id)
        do {
            try await client.triggerScrapeRun(sourceCode: source.code)
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
        }
        runningSourceIDs.remove(source.id)
    }

    func fetchRecentRuns(
        for sourceCode: String,
        using client: APIClient,
        limit: Int = 10
    ) async -> Result<[ScrapeRun], Error> {
        do {
            let allRuns = try await client.fetchScrapeRuns(limit: 200)
            let runs = Array(allRuns.filter { $0.sourceCode == sourceCode }.prefix(limit))
            return .success(runs)
        } catch {
            Log.ui.error("Failed to load scrape runs for \(sourceCode, privacy: .public): \(AppErrorPresentation.message(for: error), privacy: .public)")
            return .failure(error)
        }
    }

    private func sourceSort(lhs: Source, rhs: Source) -> Bool {
        if lhs.isActive != rhs.isActive {
            return lhs.isActive && !rhs.isActive
        }
        if lhs.healthStatus.sortOrder != rhs.healthStatus.sortOrder {
            return lhs.healthStatus.sortOrder < rhs.healthStatus.sortOrder
        }
        return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
    }

    private func lifecycleOpsSort(lhs: LifecycleOpsRow, rhs: LifecycleOpsRow) -> Bool {
        if lhs.staleExpired7d != rhs.staleExpired7d {
            return lhs.staleExpired7d > rhs.staleExpired7d
        }
        if lhs.staleExpired24h != rhs.staleExpired24h {
            return lhs.staleExpired24h > rhs.staleExpired24h
        }
        if lhs.explicitDead7d != rhs.explicitDead7d {
            return lhs.explicitDead7d > rhs.explicitDead7d
        }
        return lhs.sourceName.localizedCaseInsensitiveCompare(rhs.sourceName) == .orderedAscending
    }
}
