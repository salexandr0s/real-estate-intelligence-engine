import Foundation

// MARK: - Error Response

/// The server's error envelope: `{"error":{"code":"...","message":"...","details":{...}}}`.
struct APIErrorResponse: Codable {
    let error: APIErrorDetail
}

struct APIErrorDetail: Codable {
    let code: String
    let message: String
    /// Free-form JSON, such as the failing field and issues of a validation error.
    let details: JSONValue?
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
            if let message = detail?.message, !message.isEmpty {
                return message
            }
            return "The server couldn’t complete the request (HTTP \(code))."
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

extension APIError {
    /// The HTTP status the server answered with, or nil when no response arrived.
    var statusCode: Int? {
        switch self {
        case .httpError(let statusCode, _): statusCode
        case .unauthorized: 401
        case .notFound: 404
        default: nil
        }
    }

    /// The envelope's `code`, such as `conflict`, `rate_limited` or `outreach_enqueue_failed`.
    /// Nil when the response had no envelope, and for `.unauthorized` and `.notFound`.
    var serverCode: String? {
        guard case .httpError(_, let detail) = self else { return nil }
        return detail?.code
    }
}
