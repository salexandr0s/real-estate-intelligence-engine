import Foundation

/// View model for saved search filters management.
@MainActor @Observable
final class FiltersViewModel {

    // MARK: - State

    var filters: [Filter] = []
    var isLoading: Bool = false
    var errorMessage: String?
    var editorPresentation: FilterEditorPresentation?

    // MARK: - Test Filter State

    var testResultsPresentation: FilterTestResultsPresentation?
    var testingFilterId: Int?
    var testResultListings: [Listing] = []
    var isTestingFilter: Bool = false
    var testErrorMessage: String?

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        do {
            filters = try await client.fetchFilters()
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
        }

        isLoading = false
    }

    func toggleActive(_ filter: Filter, using client: APIClient) async {
        guard let index = filters.firstIndex(where: { $0.id == filter.id }) else { return }
        let newActive = !filters[index].isActive
        filters[index].isActive = newActive
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

    func deleteFilter(_ filter: Filter, using client: APIClient, undoManager: UndoManager? = nil) async {
        let backup = filters
        filters.removeAll { $0.id == filter.id }
        do {
            try await client.deleteFilter(id: filter.id)
            // Register undo: re-create the filter via its draft
            undoManager?.registerUndo(withTarget: self) { vm in
                Task { @MainActor in
                    let draft = FilterDraft.from(filter)
                    await vm.saveFilter(draft, using: client)
                }
            }
            undoManager?.setActionName("Delete Filter")
        } catch {
            // Revert optimistic delete on failure
            filters = backup
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
