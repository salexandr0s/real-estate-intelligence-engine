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
