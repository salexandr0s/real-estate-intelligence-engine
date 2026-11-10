import XCTest
@testable import ImmoRadar

/// Saving an edit replaces the filter's whole criteria set, so the draft must carry every field
/// back, the ones the editor doesn't show included.
@MainActor
final class FilterDraftTests: XCTestCase {
    func testDraftRoundTripsEveryCriteriaField() {
        let filter = Filter(
            id: 11,
            name: "Altbau 1070",
            filterKind: .saved,
            isActive: true,
            criteria: FilterCriteria(
                operationType: .sale,
                propertyTypes: [.house, .apartment],
                districts: [9, 7, 2],
                minPriceEur: 200_000,
                maxPriceEur: 450_000,
                minAreaSqm: 55.5,
                maxAreaSqm: 120,
                minRooms: 2.5,
                maxRooms: 3.5,
                minScore: 72,
                requiredKeywords: ["Altbau", "Balkon, Hof"],
                excludedKeywords: ["Baurecht", "unbefristet vermietet"],
                sortBy: "price_asc"
            ),
            alertFrequency: .hourly,
            alertChannels: ["in_app", "email"],
            createdAt: nil,
            updatedAt: nil,
            matchCount: nil
        )

        let draft = FilterDraft.from(filter)
        XCTAssertEqual(draft.toCriteria(), filter.criteria)

        let request = draft.toAPICreateRequest()
        XCTAssertEqual(request.sortBy, "price_asc")
        XCTAssertEqual(request.minRooms, 2.5)
        XCTAssertEqual(request.filterKind, FilterKind.saved.rawValue)
        XCTAssertEqual(request.alertFrequency, AlertFrequency.hourly.rawValue)
        XCTAssertEqual(request.alertChannels, ["in_app", "email"])
    }

    /// The server sends euros with cents when the stored price has them. One such filter must
    /// not fail the whole list, and the whole-euro range must not lose any listing.
    func testFractionalEuroPricesDecodeAndRoundOutward() throws {
        let json = Data("""
        {"id": 3, "name": "Cents", "filterKind": "alert", "isActive": true,
         "minPriceEur": 199999.5, "maxPriceEur": 450000.25, "alertChannels": ["in_app"],
         "createdAt": "2026-11-01T10:00:00.000Z", "updatedAt": "2026-11-01T10:00:00.000Z"}
        """.utf8)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase

        let dto = try decoder.decode(APIFilterResponse.self, from: json)

        XCTAssertEqual(dto.wholeEuroMinPrice, 199_999)
        XCTAssertEqual(dto.wholeEuroMaxPrice, 450_001)
        XCTAssertEqual(dto.alertChannels, ["in_app"])
    }

    /// The editor offers Instant and Off. A digest shows as Instant and stays a digest until the
    /// user picks Off.
    func testDigestFrequencyKeepsItsValueUntilThePickerChanges() {
        let draft = FilterDraft()
        draft.alertFrequency = .daily

        XCTAssertEqual(draft.alertFrequencyChoice, .instant)
        draft.alertFrequencyChoice = .instant
        XCTAssertEqual(draft.alertFrequency, .daily)
        draft.alertFrequencyChoice = .off
        XCTAssertEqual(draft.alertFrequency, .off)
    }
}
