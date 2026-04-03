import Foundation

struct PricePoint: Codable, Identifiable {
    let date: Date
    let priceEur: Int

    var id: String { "\(date.timeIntervalSince1970)-\(priceEur)" }
}
