import Foundation

// MARK: - Filter Draft

/// Mutable draft used by FilterEditorView for editing.
@MainActor @Observable
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
