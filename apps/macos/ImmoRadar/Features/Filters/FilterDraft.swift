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

    var nameError: String? {
        name.trimmingCharacters(in: .whitespaces).isEmpty ? "Filter name is required" : nil
    }

    var priceRangeError: String? {
        if let min = Int(minPriceStr), let max = Int(maxPriceStr), min > max {
            return "Min price must be less than max price"
        }
        return nil
    }

    var areaRangeError: String? {
        if let min = Double(minAreaStr), let max = Double(maxAreaStr), min > max {
            return "Min area must be less than max area"
        }
        return nil
    }

    var roomsRangeError: String? {
        if let min = Int(minRoomsStr), let max = Int(maxRoomsStr), min > max {
            return "Min rooms must be less than max rooms"
        }
        return nil
    }

    var isValid: Bool {
        nameError == nil && priceRangeError == nil && areaRangeError == nil && roomsRangeError == nil
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

    func toAPICreateRequest() -> APICreateFilterRequest {
        let criteria = toCriteria()
        return APICreateFilterRequest(
            name: name,
            filterKind: "alert",
            operationType: criteria.operationType?.rawValue,
            propertyTypes: criteria.propertyTypes.map(\.rawValue),
            districts: criteria.districts,
            minPriceEur: criteria.minPriceEur,
            maxPriceEur: criteria.maxPriceEur,
            minAreaSqm: criteria.minAreaSqm,
            maxAreaSqm: criteria.maxAreaSqm,
            minRooms: criteria.minRooms,
            maxRooms: criteria.maxRooms,
            minScore: criteria.minScore,
            requiredKeywords: criteria.requiredKeywords,
            excludedKeywords: criteria.excludedKeywords,
            alertFrequency: alertFrequency.rawValue
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
