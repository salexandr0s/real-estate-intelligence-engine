import Foundation

// MARK: - Listing DTOs

struct APIListingResponse: Codable {
    let id: Int
    let listingUid: String
    let sourceCode: String
    let title: String
    let canonicalUrl: String
    let operationType: String
    let propertyType: String
    let city: String
    let postalCode: String?
    let districtNo: Int?
    let districtName: String?
    let listPriceEur: Double?
    let livingAreaSqm: Double?
    let rooms: Double?
    let pricePerSqmEur: Double?
    let currentScore: Double?
    let latitude: Double?
    let longitude: Double?
    let geocodePrecision: String?
    let firstSeenAt: String
    let listingStatus: String?

    func toDomain(decoder: JSONDecoder) -> Listing? {
        guard let opType = OperationType(rawValue: operationType),
              let propType = PropertyType(rawValue: propertyType) else {
            return nil
        }

        let date = ISO8601DateFormatter.shared.date(from: firstSeenAt) ?? .now
        let status = ListingStatus(rawValue: listingStatus ?? "active") ?? .active

        return Listing(
            id: id,
            listingUid: listingUid,
            sourceCode: sourceCode,
            title: title,
            canonicalUrl: canonicalUrl,
            operationType: opType,
            propertyType: propType,
            city: city,
            postalCode: postalCode,
            districtNo: districtNo,
            districtName: districtName,
            listPriceEur: Int(listPriceEur ?? 0),
            livingAreaSqm: livingAreaSqm,
            rooms: rooms,
            pricePerSqmEur: pricePerSqmEur,
            currentScore: currentScore,
            latitude: latitude,
            longitude: longitude,
            geocodePrecision: geocodePrecision,
            firstSeenAt: date,
            listingStatus: status
        )
    }
}
