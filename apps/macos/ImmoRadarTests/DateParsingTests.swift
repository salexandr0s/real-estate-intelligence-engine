import Foundation
import XCTest
@testable import ImmoRadar

final class DateParsingTests: XCTestCase {
    func testFromISOReturnsNilForMissingOrInvalidInput() {
        XCTAssertNil(Date.fromISO(nil))
        XCTAssertNil(Date.fromISO("not-a-date"))
    }

    func testFromISOReturnsDateForValidTimestamp() {
        XCTAssertNotNil(Date.fromISO("2026-03-01T12:34:56.789Z"))
    }

    func testListingMappingPreservesInvalidFirstSeenDateAsNil() {
        let dto = APIListingResponse(
            id: 1,
            listingUid: "listing-1",
            sourceCode: "willhaben",
            title: "Sample Listing",
            canonicalUrl: "https://example.com/listing/1",
            operationType: OperationType.sale.rawValue,
            propertyType: PropertyType.apartment.rawValue,
            city: "Wien",
            postalCode: "1010",
            districtNo: 1,
            districtName: "Innere Stadt",
            listPriceEur: 250_000,
            listPriceEurCents: nil,
            livingAreaSqm: 60,
            rooms: 2,
            pricePerSqmEur: 4166.67,
            currentScore: 82,
            latitude: 48.2082,
            longitude: 16.3738,
            geocodePrecision: "source_exact",
            geocodeSource: "source",
            lastPriceChangePct: nil,
            lastPriceChangeAt: nil,
            firstSeenAt: "invalid-date",
            listingStatus: ListingStatus.active.rawValue,
            contactName: nil,
            contactCompany: nil,
            contactEmail: nil,
            contactPhone: nil,
            outreachSummary: nil
        )

        let listing = dto.toDomain(decoder: JSONDecoder())

        XCTAssertNotNil(listing)
        XCTAssertNil(listing?.firstSeenAt)
    }

    func testAlertMappingPreservesInvalidMatchedDateAsNil() {
        let dto = APIAlertResponse(
            id: 1,
            alertType: AlertType.newMatch.rawValue,
            status: AlertStatus.unread.rawValue,
            title: "Alert",
            body: "Body",
            matchedAt: "bad-date",
            filterName: "Value Filter",
            listingId: 123,
            matchReasons: nil,
            listing: nil
        )

        let alert = dto.toDomain(decoder: JSONDecoder())

        XCTAssertNil(alert.matchedAt)
    }

    func testDistrictTrendParsedDateReturnsNilForMalformedInput() {
        let point = DistrictTrendPoint(
            districtNo: 1,
            date: "2026-13-42",
            avgMedianPpsqm: 5000,
            totalSamples: 10,
            avgP25: 4500,
            avgP75: 5500
        )

        XCTAssertNil(point.parsedDate)
    }
}
