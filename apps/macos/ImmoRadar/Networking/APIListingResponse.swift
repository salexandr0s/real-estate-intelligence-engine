import Foundation

// MARK: - Listing DTOs

struct APIListingResponse: Codable {
    let id: Int
    let listingUid: String
    let sourceCode: String?
    let title: String
    let canonicalUrl: String
    let operationType: String
    let propertyType: String
    let city: String
    let postalCode: String?
    let districtNo: Int?
    let districtName: String?
    let listPriceEur: Double?
    let listPriceEurCents: Int?
    let livingAreaSqm: Double?
    let rooms: Double?
    let pricePerSqmEur: Double?
    let currentScore: Double?
    let latitude: Double?
    let longitude: Double?
    let geocodePrecision: String?
    let geocodeSource: String?
    let lastPriceChangePct: Double?
    let lastPriceChangeAt: String?
    let firstSeenAt: String
    let listingStatus: String?
    let contactName: String?
    let contactCompany: String?
    let contactEmail: String?
    let contactPhone: String?
    let outreachSummary: APIOutreachSummaryResponse?

    func toDomain(decoder: JSONDecoder) -> Listing? {
        guard let opType = OperationType(rawValue: operationType),
              let propType = PropertyType(rawValue: propertyType) else {
            return nil
        }

        let date = Date.fromISO(firstSeenAt)
        let priceChangeDate = lastPriceChangeAt.flatMap(Date.fromISO)
        let status = ListingStatus(rawValue: listingStatus ?? "active") ?? .active

        let resolvedPriceEur: Int?
        if let listPriceEurCents {
            resolvedPriceEur = listPriceEurCents / 100
        } else {
            resolvedPriceEur = listPriceEur.map(Int.init)
        }

        return Listing(
            id: id,
            listingUid: listingUid,
            sourceCode: sourceCode ?? "unknown",
            title: title,
            canonicalUrl: canonicalUrl,
            operationType: opType,
            propertyType: propType,
            city: city,
            postalCode: postalCode,
            districtNo: districtNo,
            districtName: districtName,
            listPriceEur: resolvedPriceEur,
            livingAreaSqm: livingAreaSqm,
            rooms: rooms,
            pricePerSqmEur: pricePerSqmEur,
            currentScore: currentScore,
            latitude: latitude,
            longitude: longitude,
            geocodePrecision: geocodePrecision,
            geocodeSource: geocodeSource,
            lastPriceChangePct: lastPriceChangePct,
            lastPriceChangeAt: priceChangeDate,
            firstSeenAt: date,
            listingStatus: status,
            contactName: contactName,
            contactCompany: contactCompany,
            contactEmail: contactEmail,
            contactPhone: contactPhone,
            outreachSummary: outreachSummary?.toDomain()
        )
    }
}
