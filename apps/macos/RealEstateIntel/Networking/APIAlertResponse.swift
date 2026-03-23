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
}

struct AlertMatchReasons: Codable, Hashable, Sendable {
    let matchedKeywords: [String]?
    let districtMatch: Bool?
    let thresholdsMet: ThresholdsMet?
    let filterName: String?

    struct ThresholdsMet: Codable, Hashable, Sendable {
        let price: Bool?
        let area: Bool?
        let rooms: Bool?
        let score: Bool?
    }
}

struct APIAlertUpdateRequest: Codable {
    let status: String
}

struct APIUnreadCountResponse: Codable {
    let unreadCount: Int
}
