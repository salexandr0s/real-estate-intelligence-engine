import Foundation

/// Saved search filter for investment criteria.
/// Maps to the `/v1/filters` API resource.
struct Filter: Identifiable, Codable, Hashable {
    let id: Int
    var name: String
    var filterKind: FilterKind
    var isActive: Bool
    var criteria: FilterCriteria
    var alertFrequency: AlertFrequency
    let createdAt: Date
    var updatedAt: Date
    var matchCount: Int?
}

// MARK: - Mock Data

extension Filter {
    static let samples: [Filter] = [
        Filter(
            id: 1,
            name: "Vienna Value Apartments",
            filterKind: .alert,
            isActive: true,
            criteria: FilterCriteria(
                operationType: .sale,
                propertyTypes: [.apartment],
                districts: [2, 3, 5, 7, 9],
                minPriceEur: nil,
                maxPriceEur: 350_000,
                minAreaSqm: 50.0,
                maxAreaSqm: nil,
                minRooms: 2,
                maxRooms: nil,
                minScore: 70.0,
                requiredKeywords: [],
                excludedKeywords: ["baurecht", "unbefristet vermietet"],
                sortBy: "score_desc"
            ),
            alertFrequency: .instant,
            createdAt: Calendar.current.date(byAdding: .day, value: -30, to: Date.now)!,
            updatedAt: Calendar.current.date(byAdding: .day, value: -2, to: Date.now)!,
            matchCount: 14
        ),
        Filter(
            id: 2,
            name: "Large Family Apartments",
            filterKind: .saved,
            isActive: true,
            criteria: FilterCriteria(
                operationType: .sale,
                propertyTypes: [.apartment],
                districts: [],
                minPriceEur: nil,
                maxPriceEur: 500_000,
                minAreaSqm: 80.0,
                maxAreaSqm: nil,
                minRooms: 3,
                maxRooms: nil,
                minScore: nil,
                requiredKeywords: [],
                excludedKeywords: [],
                sortBy: "price_asc"
            ),
            alertFrequency: .daily,
            createdAt: Calendar.current.date(byAdding: .day, value: -15, to: Date.now)!,
            updatedAt: Calendar.current.date(byAdding: .day, value: -5, to: Date.now)!,
            matchCount: 37
        ),
        Filter(
            id: 3,
            name: "Sub-4000 EUR/sqm Deals",
            filterKind: .alert,
            isActive: false,
            criteria: FilterCriteria(
                operationType: .sale,
                propertyTypes: [.apartment, .house],
                districts: [2, 10, 11, 20, 21, 22],
                minPriceEur: nil,
                maxPriceEur: 250_000,
                minAreaSqm: 40.0,
                maxAreaSqm: nil,
                minRooms: nil,
                maxRooms: nil,
                minScore: 60.0,
                requiredKeywords: ["provisionsfrei"],
                excludedKeywords: [],
                sortBy: "score_desc"
            ),
            alertFrequency: .hourly,
            createdAt: Calendar.current.date(byAdding: .day, value: -7, to: Date.now)!,
            updatedAt: Calendar.current.date(byAdding: .day, value: -7, to: Date.now)!,
            matchCount: 8
        ),
    ]

    static var emptyCriteria: FilterCriteria {
        FilterCriteria(
            operationType: nil,
            propertyTypes: [],
            districts: [],
            minPriceEur: nil,
            maxPriceEur: nil,
            minAreaSqm: nil,
            maxAreaSqm: nil,
            minRooms: nil,
            maxRooms: nil,
            minScore: nil,
            requiredKeywords: [],
            excludedKeywords: [],
            sortBy: nil
        )
    }
}
