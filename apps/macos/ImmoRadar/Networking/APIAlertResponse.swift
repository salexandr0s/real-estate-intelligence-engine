import Foundation

// MARK: - Alert DTOs

struct APIAlertResponse: Codable {
    let id: Int
    let alertType: String
    let status: String
    let title: String
    let body: String
    let matchedAt: String
    let filterName: String?
    let listingId: Int?
    let matchReasons: AlertMatchReasons?
    let listing: APIAlertListingSummaryResponse?

    func toDomain(decoder: JSONDecoder) -> Alert {
        Alert(
            id: id,
            alertType: AlertType(rawValue: alertType) ?? .newMatch,
            status: AlertStatus(rawValue: status) ?? .unread,
            title: title,
            body: body,
            matchedAt: Date.fromISO(matchedAt),
            filterName: filterName,
            listingId: listingId,
            matchReasons: matchReasons,
            listing: listing?.toDomain()
        )
    }
}
