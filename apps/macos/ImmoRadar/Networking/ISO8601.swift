import Foundation

extension Date {
    /// Parse ISO 8601 string with fractional seconds, falling back to .now.
    static func fromISO(_ string: String?) -> Date {
        guard let string else { return .now }
        let strategy = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        return (try? Date(string, strategy: strategy)) ?? .now
    }
}
