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
    /// Why the last load failed. The view hides it while the global connection banner shows.
    var loadErrorMessage: String?
    /// Why the user's last action (switch, interval, run) failed.
    var errorMessage: String?

    /// Tracks which source IDs currently have a manual scrape in progress.
    var runningSourceIDs: Set<Int> = []
    /// Sources whose switch-on or switch-off request is in flight.
    var togglingSourceIDs: Set<Int> = []
    /// True while Pause All or Resume All is in flight.
    var isUpdatingAll = false

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

    // Every source lands in exactly one section, so none drops out of the list.

    var needsAttentionSources: [Source] {
        sources
            .filter { $0.isActive && !Self.isDisabled($0) && ($0.healthStatus == .blocked || $0.healthStatus == .degraded) }
            .sorted(by: sourceSort)
    }

    var unknownSources: [Source] {
        sources
            .filter { $0.isActive && !Self.isDisabled($0) && $0.healthStatus == .unknown }
            .sorted(by: sourceSort)
    }

    var healthySources: [Source] {
        sources
            .filter { $0.isActive && !Self.isDisabled($0) && $0.healthStatus == .healthy }
            .sorted(by: sourceSort)
    }

    var pausedSources: [Source] {
        sources
            .filter { !$0.isActive && !Self.isDisabled($0) }
            .sorted(by: sourceSort)
    }

    /// Sources that failed runs or the legal status switched off, whatever `isActive` says.
    var disabledSources: [Source] {
        sources
            .filter(Self.isDisabled)
            .sorted(by: sourceSort)
    }

    // MARK: - Source Rules

    static func isDisabled(_ source: Source) -> Bool {
        source.legalStatus == .disabled || source.healthStatus == .disabled
    }

    /// Why the source can't run, with the cause first, or nil when nothing about the source
    /// stops it. The server's `runRefusal` in apps/api/src/routes/sources.ts checks the same.
    static func disabledExplanation(for source: Source) -> String? {
        if source.legalStatus == .disabled {
            return "Legally disabled. This source can’t run or be switched on."
        }
        if source.healthStatus == .disabled {
            let cause = source.disabledReason.map { " (\($0))" } ?? ""
            return source.isActive
                ? "Stopped after repeated failed runs\(cause). Switch it off and on again to run it."
                : "Switched off after repeated failed runs\(cause). Switch it on to run it again."
        }
        if !source.isActive {
            if let reason = source.disabledReason {
                return "Switched off: \(reason)."
            }
            return "Switched off. Switch it on to run it."
        }
        return nil
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
        loadErrorMessage = nil

        do {
            sources = try await client.fetchSources()
            sources.sort(by: sourceSort)
        } catch {
            // The last loaded sources stay.
            loadErrorMessage = AppErrorPresentation.message(for: error)
        }

        isLoading = false
    }

    func clearError() {
        errorMessage = nil
    }

    func clearLoadError() {
        loadErrorMessage = nil
    }

    /// Switches one source on or off. On any error, a 409 for a legally disabled source among
    /// them, the switch goes back and the server's message shows.
    func toggleActive(_ source: Source, using client: APIClient) async {
        guard !togglingSourceIDs.contains(source.id),
              let index = sources.firstIndex(where: { $0.id == source.id }) else { return }
        let newActive = !sources[index].isActive
        sources[index].isActive = newActive
        togglingSourceIDs.insert(source.id)
        defer { togglingSourceIDs.remove(source.id) }

        do {
            try await client.updateSource(id: source.id, isActive: newActive)
            // Switching on also clears a failed-runs disable on the server, so reload what it says.
            await reloadQuietly(using: client)
        } catch {
            if let idx = sources.firstIndex(where: { $0.id == source.id }) {
                sources[idx].isActive = !newActive
            }
            errorMessage = AppErrorPresentation.message(for: error)
        }
    }

    /// Pause All or Resume All. Resuming skips legally disabled sources, as the server does.
    /// On any error every switch goes back and the server's message shows.
    func togglePauseAll(using client: APIClient) async {
        guard !isUpdatingAll else { return }
        let shouldPause = !allPaused
        let previousActive = Dictionary(uniqueKeysWithValues: sources.map { ($0.id, $0.isActive) })
        for i in sources.indices where shouldPause || sources[i].legalStatus != .disabled {
            sources[i].isActive = !shouldPause
        }
        isUpdatingAll = true
        defer { isUpdatingAll = false }

        do {
            if shouldPause {
                try await client.pauseAllSources()
            } else {
                try await client.resumeAllSources()
            }
            await reloadQuietly(using: client)
        } catch {
            for i in sources.indices {
                if let wasActive = previousActive[sources[i].id] {
                    sources[i].isActive = wasActive
                }
            }
            errorMessage = AppErrorPresentation.message(for: error)
        }
    }

    /// The server's view of the sources after a change. A failed reload keeps the local state.
    private func reloadQuietly(using client: APIClient) async {
        guard let reloaded = try? await client.fetchSources() else {
            sources.sort(by: sourceSort)
            return
        }
        sources = reloaded.sorted(by: sourceSort)
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
