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

    // MARK: - Test Filter State

    var testResultsPresentation: FilterTestResultsPresentation?
    var testingFilterId: Int?
    var testResultListings: [Listing] = []
    var isTestingFilter: Bool = false
    var testErrorMessage: String?

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        isLoading = true
        loadErrorMessage = nil

        do {
            filters = try await client.fetchFilters()
        } catch {
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
        defer { togglingFilterIDs.remove(filter.id) }

        do {
            try await client.updateFilter(id: filter.id, isActive: newActive)
        } catch {
            // Re-lookup by ID after await — array may have changed
            if let idx = filters.firstIndex(where: { $0.id == filter.id }) {
                filters[idx].isActive = !newActive
            }
            errorMessage = AppErrorPresentation.message(for: error)
        }
    }

    /// Deletes a filter. A 404 means it was already gone, so it leaves the list without an error.
    /// Undo creates it again with POST, under a new id.
    func deleteFilter(_ filter: Filter, using client: APIClient, undoManager: UndoManager? = nil) async {
        guard let index = filters.firstIndex(where: { $0.id == filter.id }) else { return }
        filters.remove(at: index)

        do {
            try await client.deleteFilter(id: filter.id)
        } catch APIError.notFound {
            // Already deleted elsewhere: the list now matches the server.
        } catch {
            // Back in its place, unless a reload brought it back meanwhile.
            if !filters.contains(where: { $0.id == filter.id }) {
                filters.insert(filter, at: min(index, filters.count))
            }
            errorMessage = AppErrorPresentation.message(for: error)
            return
        }

        undoManager?.registerUndo(withTarget: self) { vm in
            Task { @MainActor in
                await vm.recreateFilter(filter, using: client)
            }
        }
        undoManager?.setActionName("Delete Filter")
    }

    /// Undo of a delete: POST the deleted filter's name, kind, criteria and frequency again. The
    /// server gives it a new id. A paused filter is paused again after the create.
    func recreateFilter(_ filter: Filter, using client: APIClient) async {
        do {
            var created = try await client.createFilter(FilterDraft.from(filter).toAPICreateRequest())
            if !filter.isActive {
                try await client.updateFilter(id: created.id, isActive: false)
                created.isActive = false
            }
            filters.append(created)
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
        }
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
    }
}
