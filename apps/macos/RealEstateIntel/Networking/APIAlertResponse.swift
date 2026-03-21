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
    let listing: APIListingResponse?
}

struct APIAlertUpdateRequest: Codable {
    let status: String
}

struct APIUnreadCountResponse: Codable {
    let unreadCount: Int
}
