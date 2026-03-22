import Foundation

// MARK: - Response Envelope

/// Standard API response wrapper matching the backend envelope.
struct APIResponse<T: Codable & Sendable>: Codable, Sendable {
    let data: T
    let meta: APIResponseMeta?
}

struct APIResponseMeta: Codable, Sendable {
    let nextCursor: String?
    let pageSize: Int?
    let totalCount: Int?
}

/// Paginated list response.
struct PaginatedResponse<T: Codable & Sendable>: Codable, Sendable {
    let data: [T]
    let meta: APIResponseMeta?
}
