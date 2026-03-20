import Foundation

/// View model for saved search filters management.
@Observable
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
            filters[index].updatedAt = Date()
        } else {
            let newFilter = Filter(
                id: (filters.map(\.id).max() ?? 0) + 1,
                name: draft.name,
                filterKind: .alert,
                isActive: true,
                criteria: draft.toCriteria(),
                alertFrequency: draft.alertFrequency,
                createdAt: Date(),
                updatedAt: Date(),
                matchCount: nil
            )
            filters.append(newFilter)
        }
        showingEditor = false
        editingFilter = nil
    }
}

// MARK: - Filter Draft

/// Mutable draft used by FilterEditorView for editing.
@Observable
final class FilterDraft {
    var name: String = ""
    var operationType: OperationType? = nil
    var selectedPropertyTypes: Set<PropertyType> = []
    var selectedDistricts: Set<Int> = []
    var minPriceStr: String = ""
    var maxPriceStr: String = ""
    var minAreaStr: String = ""
    var maxAreaStr: String = ""
    var minRoomsStr: String = ""
    var maxRoomsStr: String = ""
    var keywords: String = ""
    var excludedKeywordsStr: String = ""
    var alertFrequency: AlertFrequency = .instant

    var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
    }

    func toCriteria() -> FilterCriteria {
        FilterCriteria(
            operationType: operationType,
            propertyTypes: Array(selectedPropertyTypes),
            districts: Array(selectedDistricts).sorted(),
            minPriceEur: Int(minPriceStr),
            maxPriceEur: Int(maxPriceStr),
            minAreaSqm: Double(minAreaStr),
            maxAreaSqm: Double(maxAreaStr),
            minRooms: Int(minRoomsStr),
            maxRooms: Int(maxRoomsStr),
            minScore: nil,
            requiredKeywords: keywords.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
            excludedKeywords: excludedKeywordsStr.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
            sortBy: "score_desc"
        )
    }

    static func from(_ filter: Filter) -> FilterDraft {
        let draft = FilterDraft()
        draft.name = filter.name
        draft.operationType = filter.criteria.operationType
        draft.selectedPropertyTypes = Set(filter.criteria.propertyTypes)
        draft.selectedDistricts = Set(filter.criteria.districts)
        if let v = filter.criteria.minPriceEur { draft.minPriceStr = String(v) }
        if let v = filter.criteria.maxPriceEur { draft.maxPriceStr = String(v) }
        if let v = filter.criteria.minAreaSqm { draft.minAreaStr = String(v) }
        if let v = filter.criteria.maxAreaSqm { draft.maxAreaStr = String(v) }
        if let v = filter.criteria.minRooms { draft.minRoomsStr = String(v) }
        if let v = filter.criteria.maxRooms { draft.maxRoomsStr = String(v) }
        draft.keywords = filter.criteria.requiredKeywords.joined(separator: ", ")
        draft.excludedKeywordsStr = filter.criteria.excludedKeywords.joined(separator: ", ")
        draft.alertFrequency = filter.alertFrequency
        return draft
    }
}

// MARK: - Vienna Districts

/// All 23 Vienna districts for the district picker.
enum ViennaDistricts {
    static let all: [(number: Int, name: String)] = [
        (1, "Innere Stadt"), (2, "Leopoldstadt"), (3, "Landstrasse"),
        (4, "Wieden"), (5, "Margareten"), (6, "Mariahilf"),
        (7, "Neubau"), (8, "Josefstadt"), (9, "Alsergrund"),
        (10, "Favoriten"), (11, "Simmering"), (12, "Meidling"),
        (13, "Hietzing"), (14, "Penzing"), (15, "Rudolfsheim-Fuenfhaus"),
        (16, "Ottakring"), (17, "Hernals"), (18, "Waehring"),
        (19, "Doebling"), (20, "Brigittenau"), (21, "Floridsdorf"),
        (22, "Donaustadt"), (23, "Liesing"),
    ]
}
