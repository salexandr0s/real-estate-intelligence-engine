import Foundation

/// View model for saved search filters management.
@MainActor @Observable
final class FiltersViewModel {

    // MARK: - State

    var filters: [Filter] = []
    var isLoading: Bool = false
    var errorMessage: String?
    var showingEditor: Bool = false
    var editingFilter: Filter?

    // MARK: - Test Filter State

    var showingTestResults: Bool = false
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
            errorMessage = error.localizedDescription
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
            errorMessage = error.localizedDescription
        }
    }

    func deleteFilter(_ filter: Filter, using client: APIClient) async {
        let backup = filters
        filters.removeAll { $0.id == filter.id }
        do {
            try await client.deleteFilter(id: filter.id)
        } catch {
            // Revert optimistic delete on failure
            filters = backup
            errorMessage = error.localizedDescription
        }
    }

    func startNewFilter() {
        editingFilter = nil
        showingEditor = true
    }

    func startEditing(_ filter: Filter) {
        editingFilter = filter
        showingEditor = true
    }

    func testFilter(_ filter: Filter, using client: APIClient) async {
        isTestingFilter = true
        testingFilterId = filter.id
        testErrorMessage = nil
        defer { isTestingFilter = false }
        do {
            testResultListings = try await client.testFilter(id: filter.id)
            showingTestResults = true
        } catch {
            testErrorMessage = error.localizedDescription
        }
    }

    func duplicateFilter(_ filter: Filter) {
        let draft = FilterDraft.from(filter)
        draft.name = "Copy of \(filter.name)"
        pendingDraft = draft
        editingFilter = nil
        showingEditor = true
    }

    /// Transient draft for the duplicate flow, consumed by the editor sheet on presentation.
    var pendingDraft: FilterDraft?

    func saveFilter(_ draft: FilterDraft, using client: APIClient) async {
        errorMessage = nil
        let apiRequest = draft.toAPICreateRequest()
        do {
            if let existing = editingFilter {
                let updated = try await client.updateFilterFull(id: existing.id, apiRequest: apiRequest)
                if let index = filters.firstIndex(where: { $0.id == existing.id }) {
                    filters[index] = updated
                }
            } else {
                let created = try await client.createFilterFromDraft(apiRequest)
                filters.append(created)
            }
            showingEditor = false
            editingFilter = nil
            pendingDraft = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
