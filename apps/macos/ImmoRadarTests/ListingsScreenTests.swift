import XCTest
@testable import ImmoRadar

@MainActor
final class ListingsScreenTests: XCTestCase {
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
