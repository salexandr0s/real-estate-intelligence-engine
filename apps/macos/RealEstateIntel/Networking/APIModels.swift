import Foundation

// MARK: - Response Envelope

/// Standard API response wrapper matching the backend envelope.
struct APIResponse<T: Codable>: Codable {
    let data: T
    let meta: APIResponseMeta?
}

struct APIResponseMeta: Codable {
    let nextCursor: String?
    let pageSize: Int?
}

/// Paginated list response.
struct PaginatedResponse<T: Codable>: Codable {
    let data: [T]
    let meta: APIResponseMeta?
}

// MARK: - Error Response

struct APIErrorResponse: Codable {
    let error: APIErrorDetail
}

struct APIErrorDetail: Codable {
    let code: String
    let message: String
    let details: [String: String]?
}

// MARK: - API Error

enum APIError: Error, LocalizedError {
    case invalidURL
    case networkError(underlying: Error)
    case httpError(statusCode: Int, detail: APIErrorDetail?)
    case decodingError(underlying: Error)
    case unauthorized
    case notFound
    case serverError(message: String)
    case noConnection

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid API URL configuration."
        case .networkError(let err):
            return "Network error: \(err.localizedDescription)"
        case .httpError(let code, let detail):
            if let detail {
                return "HTTP \(code): \(detail.message)"
            }
            return "HTTP error \(code)"
        case .decodingError(let err):
            return "Failed to parse response: \(err.localizedDescription)"
        case .unauthorized:
            return "Authentication required. Check your API token in Settings."
        case .notFound:
            return "The requested resource was not found."
        case .serverError(let msg):
            return "Server error: \(msg)"
        case .noConnection:
            return "Cannot connect to the API server. Check that the backend is running."
        }
    }
}

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
    let postalCode: String
    let districtNo: Int
    let districtName: String
    let listPriceEur: Int
    let livingAreaSqm: Double
    let rooms: Int
    let pricePerSqmEur: Double
    let currentScore: Double
    let firstSeenAt: String
    let listingStatus: String?

    func toDomain(decoder: JSONDecoder) -> Listing? {
        guard let opType = OperationType(rawValue: operationType),
              let propType = PropertyType(rawValue: propertyType) else {
            return nil
        }

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = iso.date(from: firstSeenAt) ?? Date()
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
            listPriceEur: listPriceEur,
            livingAreaSqm: livingAreaSqm,
            rooms: rooms,
            pricePerSqmEur: pricePerSqmEur,
            currentScore: currentScore,
            firstSeenAt: date,
            listingStatus: status
        )
    }
}

// MARK: - Filter DTOs

struct APIFilterResponse: Codable {
    let id: Int
    let name: String
    let filterKind: String
    let isActive: Bool
    let operationType: String?
    let propertyTypes: [String]?
    let districts: [Int]?
    let minPriceEur: Int?
    let maxPriceEur: Int?
    let minAreaSqm: Double?
    let maxAreaSqm: Double?
    let minRooms: Int?
    let maxRooms: Int?
    let minScore: Double?
    let requiredKeywords: [String]?
    let excludedKeywords: [String]?
    let sortBy: String?
    let alertFrequency: String?
    let createdAt: String
    let updatedAt: String
    let matchCount: Int?
}

struct APICreateFilterRequest: Codable {
    let name: String
    let filterKind: String
    let operationType: String?
    let propertyTypes: [String]
    let districts: [Int]
    let maxPriceEur: Int?
    let minAreaSqm: Double?
    let minScore: Double?
    let requiredKeywords: [String]
    let excludedKeywords: [String]
    let alertFrequency: String
}

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

// MARK: - Source DTOs

struct APISourceResponse: Codable {
    let id: Int
    let code: String
    let name: String
    let isActive: Bool
    let healthStatus: String
    let lastSuccessfulRun: String?
    let crawlIntervalMinutes: Int
    let lastErrorSummary: String?
    let totalListingsIngested: Int?
    let successRatePct: Double?
}
