import Foundation

extension Date {
    /// Parse ISO 8601 string with fractional seconds.
    /// Returns nil when the input is missing or invalid.
    static func fromISO(_ string: String?) -> Date? {
        guard let string else { return nil }
        let strategy = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        return try? Date(string, strategy: strategy)
    }

    /// Parse a plain calendar day ("2026-03-01") as the start of that day in `timeZone`.
    /// The server sends Vienna calendar days this way. Reading one as UTC midnight would show it a
    /// day early west of UTC, so it becomes local midnight of the same day instead.
    /// Returns nil when the input is missing or not a real day.
    static func fromCalendarDay(_ string: String?, timeZone: TimeZone = .current) -> Date? {
        guard let string else { return nil }
        let parts = string.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else {
            return nil
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let components = DateComponents(year: year, month: month, day: day)
        guard components.isValidDate(in: calendar) else { return nil }
        return calendar.date(from: components)
    }
}
