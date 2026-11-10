import Foundation

/// View model for saved search filters management.
@MainActor @Observable
final class FiltersViewModel {

    // MARK: - State

    var filters: [Filter] = []
    var isLoading: Bool = false
    /// Why the last load failed. The view hides it while the global connection banner shows.
    var loadErrorMessage: String?
    /// Why the user's last action (save, pause, resume, delete, undo) failed.
    var errorMessage: String?
    var editorPresentation: FilterEditorPresentation?
    /// Filters whose pause or resume request is in flight.
    var togglingFilterIDs: Set<Int> = []

    /// Goes up with each load, and when a change drops the load in flight, so an older load can't
    /// replace a newer one or undo a change.
    @ObservationIgnored private var loadGeneration = 0
    /// Changes whose request is in flight. A load waits for them, because it could read the
    /// filters before a change lands.
    @ObservationIgnored private var changesInFlight = 0
    /// A load was dropped or put off during a change, so the filters load once the last change
    /// is done.
    @ObservationIgnored private var needsReload = false

    // MARK: - Test Filter State

    var testResultsPresentation: FilterTestResultsPresentation?
    var testingFilterId: Int?
    var testResultListings: [Listing] = []
    var isTestingFilter: Bool = false
    var testErrorMessage: String?

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        guard changesInFlight == 0 else {
            needsReload = true
            return
        }
        loadGeneration += 1
        let generation = loadGeneration
        isLoading = true
        loadErrorMessage = nil

        do {
            let loaded = try await client.fetchFilters()
            guard generation == loadGeneration else { return }
            filters = loaded
        } catch {
            guard generation == loadGeneration else { return }
            // The last loaded filters stay.
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

    /// Pauses or resumes a filter. The criteria stay as they are, and a paused filter stays listed.
    func toggleActive(_ filter: Filter, using client: APIClient) async {
        guard !togglingFilterIDs.contains(filter.id),
              let index = filters.firstIndex(where: { $0.id == filter.id }) else { return }
        let newActive = !filters[index].isActive
        filters[index].isActive = newActive
        togglingFilterIDs.insert(filter.id)
        beginChange()

        do {
            try await client.updateFilter(id: filter.id, isActive: newActive)
        } catch {
            // Re-lookup by ID after await — array may have changed
            if let idx = filters.firstIndex(where: { $0.id == filter.id }) {
                filters[idx].isActive = !newActive
            }
            errorMessage = AppErrorPresentation.message(for: error)
        }

        togglingFilterIDs.remove(filter.id)
        await endChange(using: client)
    }

    /// Deletes a filter. A 404 means it was already gone, so it leaves the list without an error.
    /// Undo creates it again with POST, under a new id.
    func deleteFilter(_ filter: Filter, using client: APIClient, undoManager: UndoManager? = nil) async {
        guard let index = filters.firstIndex(where: { $0.id == filter.id }) else { return }
        filters.remove(at: index)
        beginChange()

        var isDeleted = true
        do {
            try await client.deleteFilter(id: filter.id)
        } catch APIError.notFound {
            // Already deleted elsewhere: the list now matches the server.
        } catch {
            isDeleted = false
            // Back in its place, unless it's listed again already.
            if !filters.contains(where: { $0.id == filter.id }) {
                filters.insert(filter, at: min(index, filters.count))
            }
            errorMessage = AppErrorPresentation.message(for: error)
        }

        if isDeleted {
            undoManager?.registerUndo(withTarget: self) { vm in
                Task { @MainActor in
                    await vm.recreateFilter(filter, using: client)
                }
            }
            undoManager?.setActionName("Delete Filter")
        }
        await endChange(using: client)
    }

    /// Undo of a delete: POST the deleted filter's name, kind, criteria and frequency again. The
    /// server gives it a new id and creates it active. A paused filter is paused again after the
    /// create, and shows as active if that pause fails, as it is on the server.
    func recreateFilter(_ filter: Filter, using client: APIClient) async {
        beginChange()
        do {
            let created = try await client.createFilter(FilterDraft.from(filter).toAPICreateRequest())
            filters.append(created)
            if !filter.isActive {
                try await client.updateFilter(id: created.id, isActive: false)
                if let index = filters.firstIndex(where: { $0.id == created.id }) {
                    filters[index].isActive = false
                }
            }
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
        }
        await endChange(using: client)
    }

    func startNewFilter() {
        editorPresentation = FilterEditorPresentation(
            editingFilter: nil,
            initialDraft: FilterDraft()
        )
    }

    func startEditing(_ filter: Filter) {
        editorPresentation = FilterEditorPresentation(
            editingFilter: filter,
            initialDraft: FilterDraft.from(filter)
        )
    }

    func testFilter(_ filter: Filter, using client: APIClient) async {
        isTestingFilter = true
        testingFilterId = filter.id
        testErrorMessage = nil
        defer { isTestingFilter = false }
        do {
            testResultListings = try await client.testFilter(id: filter.id)
            testResultsPresentation = FilterTestResultsPresentation()
        } catch {
            testErrorMessage = AppErrorPresentation.message(for: error)
        }
    }

    func duplicateFilter(_ filter: Filter) {
        let draft = FilterDraft.from(filter)
        draft.name = "Copy of \(filter.name)"
        editorPresentation = FilterEditorPresentation(
            editingFilter: nil,
            initialDraft: draft
        )
    }

    /// Saves the editor's draft. An edit sends the full criteria set, the fields the editor
    /// doesn't show included, so none of them is cleared.
    func saveFilter(_ draft: FilterDraft, using client: APIClient) async {
        errorMessage = nil
        let apiRequest = draft.toAPICreateRequest()
        beginChange()
        do {
            if let existing = editorPresentation?.editingFilter {
                let updated = try await client.updateFilterFull(id: existing.id, apiRequest: apiRequest)
                if let index = filters.firstIndex(where: { $0.id == existing.id }) {
                    filters[index] = updated
                }
            } else {
                let created = try await client.createFilterFromDraft(apiRequest)
                filters.append(created)
            }
            editorPresentation = nil
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
        }
        await endChange(using: client)
    }

    // MARK: - Loads During Changes

    /// Counts a change as in flight. A load already running could read the filters from before
    /// the change and undo it on screen, so that load is dropped and runs again after the change.
    private func beginChange() {
        changesInFlight += 1
        guard isLoading else { return }
        loadGeneration += 1
        isLoading = false
        needsReload = true
    }

    /// Ends a change. Once no change is in flight, the filters load if a load was dropped or put
    /// off meanwhile.
    private func endChange(using client: APIClient) async {
        changesInFlight -= 1
        guard changesInFlight == 0, needsReload else { return }
        needsReload = false
        await refresh(using: client)
    }
}
