import Foundation

// MARK: - Filter Draft

/// Mutable draft used by FilterEditorView for editing. It carries every criteria field, the
/// ones the editor doesn't show too, so saving an edit sends them back unchanged.
@MainActor @Observable
final class FilterDraft {
    var name: String = ""
    var filterKind: FilterKind = .alert
    var operationType: OperationType? = nil
    /// Ordered, so an unchanged selection goes back in the order the server sent it.
    var selectedPropertyTypes: [PropertyType] = []
    var selectedDistricts: [Int] = []
    var minPriceEur: Int? = nil
    var maxPriceEur: Int? = nil
    var minAreaSqm: Double? = nil
    var maxAreaSqm: Double? = nil
    var minRooms: Double? = nil
    var maxRooms: Double? = nil
    /// Not in the editor; kept so an edit doesn't clear it.
    var minScore: Double? = nil
    var keywords: String = ""
    var excludedKeywordsStr: String = ""
    /// The keyword lists as loaded. They go back as they are while the text still shows them, so
    /// a keyword with a comma in it survives an edit of something else.
    @ObservationIgnored private var loadedKeywords: [String] = []
    @ObservationIgnored private var loadedExcludedKeywords: [String] = []
    /// Not in the editor; nil lets the server use `score_desc`.
    var sortBy: String? = nil
    /// The stored value. A digest stays a digest unless the picker changes.
    var alertFrequency: AlertFrequency = .instant
    /// Not in the editor; kept so an edit or an undone delete doesn't reset them to `in_app`.
    var alertChannels: [String]? = nil

    /// What the editor's Instant and Off picker shows and sets. A digest shows as Instant, and
    /// picking the choice already shown keeps the stored value.
    var alertFrequencyChoice: AlertFrequency {
        get { alertFrequency.delivery }
        set {
            guard newValue != alertFrequency.delivery else { return }
            alertFrequency = newValue
        }
    }

    var nameError: String? {
        name.trimmingCharacters(in: .whitespaces).isEmpty ? "Filter name is required" : nil
    }

    var priceRangeError: String? {
        if let min = minPriceEur, let max = maxPriceEur, min > max {
            return "Min price must be less than max price"
        }
        return nil
    }

    var areaRangeError: String? {
        if let min = minAreaSqm, let max = maxAreaSqm, min > max {
            return "Min area must be less than max area"
        }
        return nil
    }

    var roomsRangeError: String? {
        if let min = minRooms, let max = maxRooms, min > max {
            return "Min rooms must be less than max rooms"
        }
        return nil
    }

    var isValid: Bool {
        nameError == nil && priceRangeError == nil && areaRangeError == nil && roomsRangeError == nil
    }

    var summaryText: String {
        let operation = operationType?.rawValue.capitalized ?? "Any"

        let propertySummary: String = {
            if selectedPropertyTypes.isEmpty { return "properties" }
            let names = selectedPropertyTypes.map(\.displayName).sorted()
            if names.count == 1 { return names[0].lowercased() }
            if names.count == 2 { return "\(names[0].lowercased()) and \(names[1].lowercased())" }
            return "\(names.count) property types"
        }()

        let districtSummary: String = {
            switch selectedDistricts.count {
            case 0: return "across Vienna"
            case 1:
                if let districtNo = selectedDistricts.first {
                    return "in district \(districtNo)"
                }
                return "across Vienna"
            default:
                return "across \(selectedDistricts.count) selected districts"
            }
        }()

        var parts = ["Track \(operation.lowercased()) \(propertySummary)", districtSummary]

        if let minPriceEur, let maxPriceEur {
            parts.append("between €\(minPriceEur.formatted()) and €\(maxPriceEur.formatted())")
        } else if let maxPriceEur {
            parts.append("up to €\(maxPriceEur.formatted())")
        } else if let minPriceEur {
            parts.append("from €\(minPriceEur.formatted())")
        }

        if let minAreaSqm, let maxAreaSqm {
            parts.append("with \(minAreaSqm.formatted(.number.precision(.fractionLength(0))))–\(maxAreaSqm.formatted(.number.precision(.fractionLength(0)))) m²")
        } else if let minAreaSqm {
            parts.append("with at least \(minAreaSqm.formatted(.number.precision(.fractionLength(0)))) m²")
        }

        if let minRooms {
            parts.append("and \(minRooms.formatted())+ rooms")
        }

        let required = keywordsList
        if !required.isEmpty {
            parts.append("including “\(required.prefix(2).joined(separator: "”, “"))”")
        }

        return parts.joined(separator: " ")
    }

    var keywordsList: [String] {
        Self.keywordList(from: keywords, loaded: loadedKeywords)
    }

    var excludedKeywordsList: [String] {
        Self.keywordList(from: excludedKeywordsStr, loaded: loadedExcludedKeywords)
    }

    private static func keywordList(from text: String, loaded: [String]) -> [String] {
        if !loaded.isEmpty, text == loaded.joined(separator: ", ") {
            return loaded
        }
        return text
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    func toCriteria() -> FilterCriteria {
        FilterCriteria(
            operationType: operationType,
            propertyTypes: selectedPropertyTypes,
            districts: selectedDistricts,
            minPriceEur: minPriceEur,
            maxPriceEur: maxPriceEur,
            minAreaSqm: minAreaSqm,
            maxAreaSqm: maxAreaSqm,
            minRooms: minRooms,
            maxRooms: maxRooms,
            minScore: minScore,
            requiredKeywords: keywordsList,
            excludedKeywords: excludedKeywordsList,
            sortBy: sortBy
        )
    }

    /// The body of a create, or of an edit's PATCH, which replaces the whole criteria set.
    func toAPICreateRequest() -> APICreateFilterRequest {
        let criteria = toCriteria()
        return APICreateFilterRequest(
            name: name,
            filterKind: filterKind.rawValue,
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
            alertFrequency: alertFrequency.rawValue,
            sortBy: criteria.sortBy,
            alertChannels: alertChannels
        )
    }

    func togglePropertyType(_ propertyType: PropertyType, isSelected: Bool) {
        selectedPropertyTypes.removeAll { $0 == propertyType }
        if isSelected { selectedPropertyTypes.append(propertyType) }
    }

    func toggleDistrict(_ districtNumber: Int, isSelected: Bool) {
        selectedDistricts.removeAll { $0 == districtNumber }
        if isSelected { selectedDistricts.append(districtNumber) }
    }

    static func from(_ filter: Filter) -> FilterDraft {
        let draft = FilterDraft()
        draft.name = filter.name
        draft.filterKind = filter.filterKind
        draft.operationType = filter.criteria.operationType
        draft.selectedPropertyTypes = filter.criteria.propertyTypes
        draft.selectedDistricts = filter.criteria.districts
        draft.minPriceEur = filter.criteria.minPriceEur
        draft.maxPriceEur = filter.criteria.maxPriceEur
        draft.minAreaSqm = filter.criteria.minAreaSqm
        draft.maxAreaSqm = filter.criteria.maxAreaSqm
        draft.minRooms = filter.criteria.minRooms
        draft.maxRooms = filter.criteria.maxRooms
        draft.minScore = filter.criteria.minScore
        draft.loadedKeywords = filter.criteria.requiredKeywords
        draft.loadedExcludedKeywords = filter.criteria.excludedKeywords
        draft.keywords = filter.criteria.requiredKeywords.joined(separator: ", ")
        draft.excludedKeywordsStr = filter.criteria.excludedKeywords.joined(separator: ", ")
        draft.sortBy = filter.criteria.sortBy
        draft.alertFrequency = filter.alertFrequency
        draft.alertChannels = filter.alertChannels
        return draft
    }
}
