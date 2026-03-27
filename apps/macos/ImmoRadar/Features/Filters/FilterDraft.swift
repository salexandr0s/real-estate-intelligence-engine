import Foundation

// MARK: - Filter Draft

/// Mutable draft used by FilterEditorView for editing.
@MainActor @Observable
final class FilterDraft {
    var name: String = ""
    var operationType: OperationType? = nil
    var selectedPropertyTypes: Set<PropertyType> = []
    var selectedDistricts: Set<Int> = []
    var minPriceEur: Int? = nil
    var maxPriceEur: Int? = nil
    var minAreaSqm: Double? = nil
    var maxAreaSqm: Double? = nil
    var minRooms: Int? = nil
    var maxRooms: Int? = nil
    var keywords: String = ""
    var excludedKeywordsStr: String = ""
    var alertFrequency: AlertFrequency = .instant

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
            parts.append("and \(minRooms)+ rooms")
        }

        let required = keywordsList
        if !required.isEmpty {
            parts.append("including “\(required.prefix(2).joined(separator: "”, “"))”")
        }

        return parts.joined(separator: " ")
    }

    var keywordsList: [String] {
        keywords
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    var excludedKeywordsList: [String] {
        excludedKeywordsStr
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    func toCriteria() -> FilterCriteria {
        FilterCriteria(
            operationType: operationType,
            propertyTypes: Array(selectedPropertyTypes),
            districts: Array(selectedDistricts).sorted(),
            minPriceEur: minPriceEur,
            maxPriceEur: maxPriceEur,
            minAreaSqm: minAreaSqm,
            maxAreaSqm: maxAreaSqm,
            minRooms: minRooms,
            maxRooms: maxRooms,
            minScore: nil,
            requiredKeywords: keywordsList,
            excludedKeywords: excludedKeywordsList,
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
        draft.minPriceEur = filter.criteria.minPriceEur
        draft.maxPriceEur = filter.criteria.maxPriceEur
        draft.minAreaSqm = filter.criteria.minAreaSqm
        draft.maxAreaSqm = filter.criteria.maxAreaSqm
        draft.minRooms = filter.criteria.minRooms
        draft.maxRooms = filter.criteria.maxRooms
        draft.keywords = filter.criteria.requiredKeywords.joined(separator: ", ")
        draft.excludedKeywordsStr = filter.criteria.excludedKeywords.joined(separator: ", ")
        draft.alertFrequency = filter.alertFrequency
        return draft
    }
}
