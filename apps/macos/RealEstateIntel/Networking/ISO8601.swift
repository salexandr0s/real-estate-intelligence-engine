import Foundation

extension ISO8601DateFormatter {
    /// Shared formatter configured for the backend's date format (with fractional seconds).
    nonisolated(unsafe) static let shared: ISO8601DateFormatter = {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fmt
    }()
}
