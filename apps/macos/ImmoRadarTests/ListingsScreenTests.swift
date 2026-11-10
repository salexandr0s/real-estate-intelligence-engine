import XCTest
@testable import ImmoRadar

@MainActor
final class ListingsScreenTests: XCTestCase {
    func testProjectAPIPriceAndCacheRoundTrip() throws {
        let data = Data(#"{"id":1,"listingUid":"project","sourceCode":"immoscout24","title":"Projekt","canonicalUrl":"https://example.com/1","operationType":"sale","propertyType":"apartment","city":"Wien","listPriceEur":null,"isProject":true,"priceFromEurCents":38900050,"firstSeenAt":"2026-11-10T08:00:00Z"}"#.utf8)
        let decoder = JSONDecoder()
        let dto = try decoder.decode(APIListingResponse.self, from: data)
        let listing = try XCTUnwrap(dto.toDomain(decoder: decoder))
        XCTAssertEqual(listing.isProject, true)
        XCTAssertNil(listing.listPriceEur)
        XCTAssertNil(listing.currentScore)
        XCTAssertEqual(listing.priceFromEurCents, 38_900_050)
        XCTAssertTrue(listing.formattedPrice.hasPrefix("ab "))
        XCTAssertTrue(listing.formattedPrice.contains("389.000,50"))
        XCTAssertEqual(try decoder.decode(Listing.self, from: JSONEncoder().encode(listing)), listing)
    }

    func testOlderCachedListingWithoutProjectFieldsStillDecodes() throws {
        let encoded = try JSONEncoder().encode(Listing.samples[0])
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object.removeValue(forKey: "isProject")
        object.removeValue(forKey: "priceFromEurCents")
        let listing = try JSONDecoder().decode(Listing.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertNil(listing.isProject)
        XCTAssertNil(listing.priceFromEurCents)
        XCTAssertEqual(listing.formattedPrice, PriceFormatter.format(eur: listing.listPriceEur))
    }

    func testProjectViewModelClearsStaleExplanationWithoutRequestingAScore() async throws {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(Listing.samples[0])) as? [String: Any])
        object["isProject"] = true
        let project = try JSONDecoder().decode(Listing.self, from: JSONSerialization.data(withJSONObject: object))
        let model = ListingDetailViewModel(listing: project)
        model.explanation = Listing.sampleExplanation
        model.explanationLoadFailed = true
        await model.retryExplanation(using: APIClient(baseURL: "invalid://project-score-must-not-be-requested"))
        XCTAssertNil(model.explanation)
        XCTAssertFalse(model.explanationLoadFailed)
        XCTAssertFalse(model.isLoadingExplanation)
    }

    /// A server that hands back a cursor it already gave must not keep the load looping, and a
    /// listing that appears on two pages must show once.
    func testFetchAllPagesStopsOnRepeatedCursorAndDropsDuplicates() async throws {
        let samples = Array(Listing.samples.prefix(3))
        var requestedCursors: [String?] = []

        let listings = try await ListingsViewModel.fetchAllPages { cursor in
            requestedCursors.append(cursor)
            guard requestedCursors.count <= 5 else { throw CancellationError() }
            if cursor == nil {
                return (listings: [samples[0], samples[1]], nextCursor: "page-2")
            }
            return (listings: [samples[1], samples[2]], nextCursor: "page-2")
        }

        XCTAssertEqual(listings.map(\.id), samples.map(\.id))
        XCTAssertEqual(requestedCursors, [nil, "page-2"])
    }

    func testLastSeenShowsOnlyAfterFourteenDays() throws {
        let calendar = Calendar(identifier: .gregorian)
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let fourteenDaysAgo = try XCTUnwrap(calendar.date(byAdding: .day, value: -14, to: now))
        let olderSighting = fourteenDaysAgo.addingTimeInterval(-60)

        XCTAssertNil(ListingLastSeenLabel.staleSighting(fourteenDaysAgo, now: now, calendar: calendar))
        XCTAssertEqual(ListingLastSeenLabel.staleSighting(olderSighting, now: now, calendar: calendar), olderSighting)
        XCTAssertNil(ListingLastSeenLabel.staleSighting(nil, now: now, calendar: calendar))
    }
}
