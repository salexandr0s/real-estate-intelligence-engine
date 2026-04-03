import Foundation

enum AppErrorPresentation {
    static let apiConnectionTitle = "API unavailable"
    static let apiConnectionMessage =
        APIError.noConnection.errorDescription
        ?? "Cannot connect to the API server. Check that the backend is running."

    static func message(for error: Error) -> String {
        if let localized = error as? LocalizedError,
           let description = localized.errorDescription?.trimmedNonEmpty {
            return standardized(message: description)
        }

        let description = (error as NSError).localizedDescription
        if let trimmed = description.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty {
            return standardized(message: trimmed)
        }

        return standardized(message: String(describing: error))
    }

    static func standardized(message: String) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return trimmed }
        return isConnectionIssue(message: trimmed) ? apiConnectionMessage : trimmed
    }

    static func isConnectionIssue(message: String) -> Bool {
        let normalizedMessage = normalized(message)
        return normalizedMessage == normalized(apiConnectionMessage)
            || normalizedMessage == "noconnection"
    }

    private static func normalized(_ message: String) -> String {
        message
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }
}

private extension String {
    var trimmedNonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }

    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
