import Foundation

// MARK: - Alert DTOs

/// One alert as GET /v1/alerts, PATCH /v1/alerts/:id and the alert stream send it
/// (`mapAlertResponse` in apps/api/src/routes/alerts.ts).
struct APIAlertResponse: Codable {
    let id: Int
    let userFilterId: Int?
    let listingId: Int?
    let alertType: String
    let status: String
    let title: String
    let body: String
    let matchedAt: String
    let filterName: String?
    let matchReasons: AlertMatchReasons?
    let listing: APIAlertListingSummaryResponse?

    func toDomain(decoder: JSONDecoder) -> Alert {
        Alert(
            id: id,
            alertType: AlertType(rawValue: alertType) ?? .unknown,
            status: AlertStatus(serverValue: status),
            title: title,
            body: body,
            matchedAt: Date.fromISO(matchedAt),
            filterName: filterName,
            listingId: listingId,
            matchReasons: matchReasons,
            listing: listing?.toDomain(),
            userFilterId: userFilterId
        )
    }
}
