import SwiftUI

/// "Last seen <date>" for a listing that no scrape has found on its source for more than 14 days.
/// The server expires a listing only on evidence from its own page, so an old sighting can belong
/// to a listing that is still active. Shows nothing when the listing was seen recently.
struct ListingLastSeenLabel: View {
    let lastSeenAt: Date?

    /// Days without a sighting before the date shows.
    static let staleAfterDays = 14

    /// The last sighting when it is more than `staleAfterDays` days before `now`, otherwise nil.
    static func staleSighting(_ lastSeenAt: Date?, now: Date = .now, calendar: Calendar = .current) -> Date? {
        guard let lastSeenAt,
              let cutoff = calendar.date(byAdding: .day, value: -staleAfterDays, to: now),
              lastSeenAt < cutoff else {
            return nil
        }
        return lastSeenAt
    }

    var body: some View {
        if let sighting = Self.staleSighting(lastSeenAt) {
            Text("Last seen \(sighting.formatted(date: .abbreviated, time: .omitted))")
                .foregroundStyle(.secondary)
                .help("No scrape has found this listing on its source since then. It stays active until its own page shows it’s gone.")
        }
    }
}
