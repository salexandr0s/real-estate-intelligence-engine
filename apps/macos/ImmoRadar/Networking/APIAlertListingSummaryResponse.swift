import Foundation

struct APIAlertListingSummaryResponse: Codable {
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
    let listPriceEur: Double?
    let listPriceEurCents: Int?
    let livingAreaSqm: Double?
    let rooms: Double?
    let pricePerSqmEur: Double?
    let currentScore: Double?
    let latitude: Double?
    let longitude: Double?
    let geocodePrecision: String?
    let lastPriceChangePct: Double?
    let lastPriceChangeAt: String?
    let firstSeenAt: String?
    let listingStatus: String?

    func toDomain() -> AlertListingSummary {
        let resolvedPriceEur: Int?
        if let listPriceEurCents {
            resolvedPriceEur = listPriceEurCents / 100
        } else {
            resolvedPriceEur = listPriceEur.map(Int.init)
        }

        return AlertListingSummary(
            id: id,
            listingUid: listingUid,
            sourceCode: sourceCode,
            canonicalUrl: canonicalUrl,
            title: title,
            operationType: operationType,
            propertyType: propertyType,
            city: city,
            postalCode: postalCode,
            districtNo: districtNo,
            districtName: districtName,
            listPriceEur: resolvedPriceEur,
            livingAreaSqm: livingAreaSqm,
            rooms: rooms,
            pricePerSqmEur: pricePerSqmEur,
            currentScore: currentScore,
            firstSeenAt: firstSeenAt.flatMap(Date.fromISO),
            listingStatus: listingStatus,
            latitude: latitude,
            longitude: longitude,
            geocodePrecision: geocodePrecision,
            lastPriceChangePct: lastPriceChangePct,
            lastPriceChangeAt: lastPriceChangeAt.flatMap(Date.fromISO)
        )
    }
}
