import Foundation

struct AlertListingSummary: Codable, Hashable {
    let id: Int
    let listingUid: String?
    let sourceCode: String?
    let canonicalUrl: String?
    let title: String?
    let operationType: String?
    let propertyType: String?
    let city: String?
    let postalCode: String?
    let districtNo: Int?
    let districtName: String?
    let listPriceEur: Int?
    let livingAreaSqm: Double?
    let rooms: Double?
    let pricePerSqmEur: Double?
    let currentScore: Double?
    let firstSeenAt: Date?
    let listingStatus: String?
    let latitude: Double?
    let longitude: Double?
    let geocodePrecision: String?
    let lastPriceChangePct: Double?
    let lastPriceChangeAt: Date?

    var alertLocationLabel: String? {
        normalizedText(districtName)
        ?? districtNo.map { "\($0). Bezirk" }
        ?? normalizedText(city)
    }

    var sourceDisplayName: String {
        guard let sourceCode = normalizedText(sourceCode) else { return "Unknown" }
        return switch sourceCode.lowercased() {
        case "willhaben":
            "Willhaben"
        case "immoscout", "immoscout24":
            "ImmoScout24"
        case "derstandard":
            "Der Standard"
        case "findmyhome":
            "FindMyHome"
        case "openimmo":
            "OpenImmo"
        case "remax":
            "RE/MAX"
        case "wohnnet":
            "wohnnet"
        case "bazar":
            "Bazar"
        case "immoworld", "immo-world":
            "Immo-World"
        default:
            sourceCode.replacing("_", with: " ").capitalized
        }
    }

    init(
        id: Int,
        listingUid: String? = nil,
        sourceCode: String? = nil,
        canonicalUrl: String? = nil,
        title: String? = nil,
        operationType: String? = nil,
        propertyType: String? = nil,
        city: String? = nil,
        postalCode: String? = nil,
        districtNo: Int? = nil,
        districtName: String? = nil,
        listPriceEur: Int? = nil,
        livingAreaSqm: Double? = nil,
        rooms: Double? = nil,
        pricePerSqmEur: Double? = nil,
        currentScore: Double? = nil,
        firstSeenAt: Date? = nil,
        listingStatus: String? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        geocodePrecision: String? = nil,
        lastPriceChangePct: Double? = nil,
        lastPriceChangeAt: Date? = nil
    ) {
        self.id = id
        self.listingUid = listingUid
        self.sourceCode = sourceCode
        self.canonicalUrl = canonicalUrl
        self.title = title
        self.operationType = operationType
        self.propertyType = propertyType
        self.city = city
        self.postalCode = postalCode
        self.districtNo = districtNo
        self.districtName = districtName
        self.listPriceEur = listPriceEur
        self.livingAreaSqm = livingAreaSqm
        self.rooms = rooms
        self.pricePerSqmEur = pricePerSqmEur
        self.currentScore = currentScore
        self.firstSeenAt = firstSeenAt
        self.listingStatus = listingStatus
        self.latitude = latitude
        self.longitude = longitude
        self.geocodePrecision = geocodePrecision
        self.lastPriceChangePct = lastPriceChangePct
        self.lastPriceChangeAt = lastPriceChangeAt
    }

    init(listing: Listing) {
        self.init(
            id: listing.id,
            listingUid: listing.listingUid,
            sourceCode: listing.sourceCode,
            canonicalUrl: listing.canonicalUrl,
            title: listing.title,
            operationType: listing.operationType.rawValue,
            propertyType: listing.propertyType.rawValue,
            city: listing.city,
            postalCode: listing.postalCode,
            districtNo: listing.districtNo,
            districtName: listing.districtName,
            listPriceEur: listing.listPriceEur,
            livingAreaSqm: listing.livingAreaSqm,
            rooms: listing.rooms,
            pricePerSqmEur: listing.pricePerSqmEur,
            currentScore: listing.currentScore,
            firstSeenAt: listing.firstSeenAt,
            listingStatus: listing.listingStatus.rawValue,
            latitude: listing.latitude,
            longitude: listing.longitude,
            geocodePrecision: listing.geocodePrecision,
            lastPriceChangePct: listing.lastPriceChangePct,
            lastPriceChangeAt: listing.lastPriceChangeAt
        )
    }

    private func normalizedText(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}

/// Alert generated when a listing matches a saved filter.
/// Maps to the `/v1/alerts` API resource.
struct Alert: Identifiable, Codable, Hashable {
    let id: Int
    let alertType: AlertType
    var status: AlertStatus
    let title: String
    let body: String
    let matchedAt: Date?
    let filterName: String?
    let listingId: Int?
    let matchReasons: AlertMatchReasons?
    let listing: AlertListingSummary?

    var matchedAtSortDate: Date {
        matchedAt ?? .distantPast
    }
}

// MARK: - Mock Data

extension Alert {
    static let samples: [Alert] = [
        Alert(
            id: 1,
            alertType: .newMatch,
            status: .unread,
            title: "New match: Sonnige 3-Zimmer nahe Prater",
            body: "Score 87.3 -- EUR 299,000 -- 72.5 sqm -- Leopoldstadt",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -1, to: .now) ?? .now,
            filterName: "Vienna Value Apartments",
            listingId: 1,
            matchReasons: nil,
            listing: .init(listing: Listing.samples[0])
        ),
        Alert(
            id: 2,
            alertType: .priceDrop,
            status: .unread,
            title: "Price drop: Preisreduziert! Helle 3-Zimmer nahe U3",
            body: "Price reduced from EUR 359,000 to EUR 335,000 (-6.7%)",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -2, to: .now) ?? .now,
            filterName: "Vienna Value Apartments",
            listingId: 8,
            matchReasons: nil,
            listing: .init(listing: Listing.samples[7])
        ),
        Alert(
            id: 3,
            alertType: .newMatch,
            status: .unread,
            title: "New match: Provisionsfrei! Renovierte Altbauwohnung",
            body: "Score 82.1 -- EUR 245,000 -- 58.0 sqm -- Landstrasse",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -4, to: .now) ?? .now,
            filterName: "Vienna Value Apartments",
            listingId: 2,
            matchReasons: nil,
            listing: .init(listing: Listing.samples[1])
        ),
        Alert(
            id: 4,
            alertType: .scoreUpgrade,
            status: .opened,
            title: "Score upgrade: Erstbezug nach Sanierung",
            body: "Score increased from 62.1 to 78.5 after price correction",
            matchedAt: Calendar.current.date(byAdding: .hour, value: -8, to: .now) ?? .now,
            filterName: "Large Family Apartments",
            listingId: 3,
            matchReasons: nil,
            listing: .init(listing: Listing.samples[2])
        ),
        Alert(
            id: 5,
            alertType: .newMatch,
            status: .opened,
            title: "New match: Anlage-Hit in Top-Lage",
            body: "Score 71.2 -- EUR 219,000 -- 48.3 sqm -- Neubau",
            matchedAt: Calendar.current.date(byAdding: .day, value: -1, to: .now) ?? .now,
            filterName: "Vienna Value Apartments",
            listingId: 4,
            matchReasons: nil,
            listing: .init(listing: Listing.samples[3])
        ),
        Alert(
            id: 6,
            alertType: .priceDrop,
            status: .dismissed,
            title: "Price drop: Dachgeschoss-Maisonette mit Terrasse",
            body: "Price reduced from EUR 549,000 to EUR 520,000 (-5.3%)",
            matchedAt: Calendar.current.date(byAdding: .day, value: -2, to: .now) ?? .now,
            filterName: nil,
            listingId: 5,
            matchReasons: nil,
            listing: .init(listing: Listing.samples[4])
        ),
        Alert(
            id: 7,
            alertType: .statusChange,
            status: .dismissed,
            title: "Status change: Garconniere zur Kapitalanlage",
            body: "Listing status changed to inactive",
            matchedAt: Calendar.current.date(byAdding: .day, value: -3, to: .now) ?? .now,
            filterName: "Sub-4000 EUR/sqm Deals",
            listingId: 6,
            matchReasons: nil,
            listing: .init(listing: Listing.samples[5])
        ),
    ]
}
