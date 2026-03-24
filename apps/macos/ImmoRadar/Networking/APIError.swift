import Foundation

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
