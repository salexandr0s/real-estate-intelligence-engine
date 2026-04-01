import Foundation

extension Date {
    /// Parse ISO 8601 string with fractional seconds.
    /// Returns nil when the input is missing or invalid.
    static func fromISO(_ string: String?) -> Date? {
        guard let string else { return nil }
        let strategy = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        return try? Date(string, strategy: strategy)
    }
}
