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

    // MARK: - Actions

    func loadMockData() {
        filters = Filter.samples
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil

        try? await Task.sleep(for: .milliseconds(300))
        loadMockData()

        isLoading = false
    }

    func toggleActive(_ filter: Filter) {
        if let index = filters.firstIndex(where: { $0.id == filter.id }) {
            filters[index].isActive.toggle()
        }
    }

    func deleteFilter(_ filter: Filter) {
        filters.removeAll { $0.id == filter.id }
    }

    func startNewFilter() {
        editingFilter = nil
        showingEditor = true
    }

    func startEditing(_ filter: Filter) {
        editingFilter = filter
        showingEditor = true
    }

    func saveFilter(_ draft: FilterDraft) {
        if let existing = editingFilter,
           let index = filters.firstIndex(where: { $0.id == existing.id }) {
            filters[index].name = draft.name
            filters[index].criteria = draft.toCriteria()
            filters[index].alertFrequency = draft.alertFrequency
            filters[index].updatedAt = Date.now
        } else {
            let newFilter = Filter(
                id: (filters.map(\.id).max() ?? 0) + 1,
                name: draft.name,
                filterKind: .alert,
                isActive: true,
                criteria: draft.toCriteria(),
                alertFrequency: draft.alertFrequency,
                createdAt: Date.now,
                updatedAt: Date.now,
                matchCount: nil
            )
            filters.append(newFilter)
        }
        showingEditor = false
        editingFilter = nil
    }
}
