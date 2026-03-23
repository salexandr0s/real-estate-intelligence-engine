import Foundation

/// A version entry representing a price snapshot at a point in time.
struct PriceVersion: Identifiable {
    let id = UUID()
    let date: Date
    let priceEur: Int
    let reason: String?
}

// MARK: - Sample Data

extension PriceVersion {
    static let samples: [PriceVersion] = [
        PriceVersion(
            date: Calendar.current.date(byAdding: .day, value: -30, to: .now)!,
            priceEur: 320_000,
            reason: "Initial listing"
        ),
        PriceVersion(
            date: Calendar.current.date(byAdding: .day, value: -14, to: .now)!,
            priceEur: 305_000,
            reason: "Price reduction"
        ),
        PriceVersion(
            date: Calendar.current.date(byAdding: .day, value: -3, to: .now)!,
            priceEur: 299_000,
            reason: "Price reduction"
        ),
    ]
}
