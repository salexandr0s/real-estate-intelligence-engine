import CoreLocation
import Foundation

/// Canonical listing model used throughout the app.
/// Maps to the `/v1/listings` API response shape.
struct Listing: Identifiable, Codable, Hashable {
    let id: Int
    let listingUid: String
    let sourceCode: String
    let title: String
    let canonicalUrl: String
    let operationType: OperationType
    let propertyType: PropertyType
    let city: String
    let postalCode: String?
    let districtNo: Int?
    let districtName: String?
    let listPriceEur: Int
    let livingAreaSqm: Double?
    let rooms: Double?
    let pricePerSqmEur: Double?
    let currentScore: Double?
    let latitude: Double?
    let longitude: Double?
    let geocodePrecision: String?
    let geocodeSource: String?
    let lastPriceChangePct: Double?
    let lastPriceChangeAt: Date?
    let firstSeenAt: Date
    let listingStatus: ListingStatus

    /// Non-optional score for sorting (0 when nil).
    var sortableScore: Double { currentScore ?? 0 }

    /// Map coordinate derived from latitude/longitude, nil if unavailable.
    var coordinate: CLLocationCoordinate2D? {
        guard let lat = latitude, let lon = longitude else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    /// Whether the geocoded location is exact enough for a precise pin.
    /// Source-provided coordinates and street-level geocoding get solid pins.
    /// Estimated (triangulated), district, and city precision get dashed rings.
    var hasExactLocation: Bool {
        geocodePrecision == "source_exact"
            || geocodePrecision == "source_approx"
            || geocodePrecision == "street"
    }

    /// Transient flag set client-side when this listing has matching alerts.
    var hasAlertMatch: Bool = false
}

// MARK: - Mock Data

extension Listing {
    static let samples: [Listing] = [
        Listing(
            id: 1,
            listingUid: "8c891f71-0cbc-4d9a-a3b8-a1af4fd5f2ea",
            sourceCode: "willhaben",
            title: "Sonnige 3-Zimmer Eigentumswohnung nahe Prater",
            canonicalUrl: "https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/wien-1020-leopoldstadt/12345",
            operationType: .sale,
            propertyType: .apartment,
            city: "Wien",
            postalCode: "1020",
            districtNo: 2,
            districtName: "Leopoldstadt",
            listPriceEur: 299_000,
            livingAreaSqm: 72.5,
            rooms: 3.0,
            pricePerSqmEur: 4124.14,
            currentScore: 87.3,
            latitude: 48.2167,
            longitude: 16.3958,
            geocodePrecision: "source_exact",
            geocodeSource: "source",
            lastPriceChangePct: nil,
            lastPriceChangeAt: nil,
            firstSeenAt: Calendar.current.date(byAdding: .hour, value: -3, to: .now) ?? .now,
            listingStatus: .active
        ),
        Listing(
            id: 2,
            listingUid: "a2f81c90-1234-4bca-9e47-deadbeef0002",
            sourceCode: "willhaben",
            title: "Provisionsfrei! Renovierte Altbauwohnung mit Balkon",
            canonicalUrl: "https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/wien-1030-landstrasse/23456",
            operationType: .sale,
            propertyType: .apartment,
            city: "Wien",
            postalCode: "1030",
            districtNo: 3,
            districtName: "Landstrasse",
            listPriceEur: 245_000,
            livingAreaSqm: 58.0,
            rooms: 2.0,
            pricePerSqmEur: 4224.14,
            currentScore: 82.1,
            latitude: 48.1986,
            longitude: 16.3948,
            geocodePrecision: "source_approx",
            geocodeSource: "source",
            lastPriceChangePct: -4.8,
            lastPriceChangeAt: Calendar.current.date(byAdding: .day, value: -2, to: Date.now),
            firstSeenAt: Calendar.current.date(byAdding: .hour, value: -5, to: .now) ?? .now,
            listingStatus: .active
        ),
        Listing(
            id: 3,
            listingUid: "b3c92d01-5678-4abc-8f58-deadbeef0003",
            sourceCode: "immoscout",
            title: "Erstbezug nach Sanierung, 4 Zimmer, Loggia",
            canonicalUrl: "https://www.immobilienscout24.at/expose/34567",
            operationType: .sale,
            propertyType: .apartment,
            city: "Wien",
            postalCode: "1050",
            districtNo: 5,
            districtName: "Margareten",
            listPriceEur: 389_000,
            livingAreaSqm: 95.0,
            rooms: 4.0,
            pricePerSqmEur: 4094.74,
            currentScore: 78.5,
            latitude: 48.1870,
            longitude: 16.3556,
            geocodePrecision: "street",
            geocodeSource: "nominatim",
            lastPriceChangePct: nil,
            lastPriceChangeAt: nil,
            firstSeenAt: Calendar.current.date(byAdding: .day, value: -1, to: .now) ?? .now,
            listingStatus: .active
        ),
        Listing(
            id: 4,
            listingUid: "c4da3e12-9abc-4def-0a69-deadbeef0004",
            sourceCode: "willhaben",
            title: "Anlage-Hit: Vermietete 2-Zi in Top-Lage",
            canonicalUrl: "https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/wien-1070-neubau/45678",
            operationType: .sale,
            propertyType: .apartment,
            city: "Wien",
            postalCode: "1070",
            districtNo: 7,
            districtName: "Neubau",
            listPriceEur: 219_000,
            livingAreaSqm: 48.3,
            rooms: 2.0,
            pricePerSqmEur: 4534.16,
            currentScore: 71.2,
            latitude: 48.2028,
            longitude: 16.3493,
            geocodePrecision: "source_exact",
            geocodeSource: "source",
            lastPriceChangePct: nil,
            lastPriceChangeAt: nil,
            firstSeenAt: Calendar.current.date(byAdding: .day, value: -2, to: .now) ?? .now,
            listingStatus: .active
        ),
        Listing(
            id: 5,
            listingUid: "d5eb4f23-0bcd-4ef0-1b7a-deadbeef0005",
            sourceCode: "immoscout",
            title: "Dachgeschoss-Maisonette mit Terrasse, Fernblick",
            canonicalUrl: "https://www.immobilienscout24.at/expose/56789",
            operationType: .sale,
            propertyType: .apartment,
            city: "Wien",
            postalCode: "1090",
            districtNo: 9,
            districtName: "Alsergrund",
            listPriceEur: 520_000,
            livingAreaSqm: 110.0,
            rooms: 4.0,
            pricePerSqmEur: 4727.27,
            currentScore: 65.8,
            latitude: 48.2263,
            longitude: 16.3560,
            geocodePrecision: "district",
            geocodeSource: "nominatim",
            lastPriceChangePct: nil,
            lastPriceChangeAt: nil,
            firstSeenAt: Calendar.current.date(byAdding: .day, value: -4, to: .now) ?? .now,
            listingStatus: .active
        ),
        Listing(
            id: 6,
            listingUid: "e6fc5034-1cde-4f01-2c8b-deadbeef0006",
            sourceCode: "willhaben",
            title: "Garconniere zur Kapitalanlage, befristet vermietet",
            canonicalUrl: "https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/wien-1100-favoriten/67890",
            operationType: .sale,
            propertyType: .apartment,
            city: "Wien",
            postalCode: "1100",
            districtNo: 10,
            districtName: "Favoriten",
            listPriceEur: 129_000,
            livingAreaSqm: 32.0,
            rooms: 1.0,
            pricePerSqmEur: 4031.25,
            currentScore: 55.4,
            latitude: 48.1625,
            longitude: 16.3827,
            geocodePrecision: "source_approx",
            geocodeSource: "source",
            lastPriceChangePct: nil,
            lastPriceChangeAt: nil,
            firstSeenAt: Calendar.current.date(byAdding: .day, value: -7, to: .now) ?? .now,
            listingStatus: .active
        ),
        Listing(
            id: 7,
            listingUid: "f70d6145-2def-4012-3d9c-deadbeef0007",
            sourceCode: "willhaben",
            title: "Baurecht! Erdgeschoss-Wohnung mit Garten",
            canonicalUrl: "https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/wien-1210-floridsdorf/78901",
            operationType: .sale,
            propertyType: .apartment,
            city: "Wien",
            postalCode: "1210",
            districtNo: 21,
            districtName: "Floridsdorf",
            listPriceEur: 185_000,
            livingAreaSqm: 65.0,
            rooms: 3.0,
            pricePerSqmEur: 2846.15,
            currentScore: 42.1,
            latitude: 48.2564,
            longitude: 16.3988,
            geocodePrecision: "source_exact",
            geocodeSource: "source",
            lastPriceChangePct: nil,
            lastPriceChangeAt: nil,
            firstSeenAt: Calendar.current.date(byAdding: .day, value: -10, to: .now) ?? .now,
            listingStatus: .active
        ),
        Listing(
            id: 8,
            listingUid: "081e7256-3ef0-4123-4ead-deadbeef0008",
            sourceCode: "immoscout",
            title: "Preisreduziert! Helle 3-Zimmer nahe U3",
            canonicalUrl: "https://www.immobilienscout24.at/expose/89012",
            operationType: .sale,
            propertyType: .apartment,
            city: "Wien",
            postalCode: "1060",
            districtNo: 6,
            districtName: "Mariahilf",
            listPriceEur: 335_000,
            livingAreaSqm: 78.0,
            rooms: 3.0,
            pricePerSqmEur: 4294.87,
            currentScore: 25.6,
            latitude: nil,
            longitude: nil,
            geocodePrecision: nil,
            geocodeSource: nil,
            lastPriceChangePct: -7.2,
            lastPriceChangeAt: Calendar.current.date(byAdding: .day, value: -5, to: Date.now),
            firstSeenAt: Calendar.current.date(byAdding: .day, value: -14, to: .now) ?? .now,
            listingStatus: .active
        ),
    ]

    static let sampleExplanation = ScoreExplanation(
        scoreVersion: 1,
        overallScore: 87.3,
        districtPriceScore: 93.0,
        undervaluationScore: 88.0,
        keywordSignalScore: 72.0,
        timeOnMarketScore: 95.0,
        confidenceScore: 90.0,
        locationScore: 75.0,
        districtBaselinePpsqmEur: 5800.0,
        bucketBaselinePpsqmEur: 5400.0,
        discountToDistrictPct: 0.2889,
        discountToBucketPct: 0.2363,
        matchedPositiveKeywords: ["provisionsfrei", "renoviert"],
        matchedNegativeKeywords: []
    )
}
