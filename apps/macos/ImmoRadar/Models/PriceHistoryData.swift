import Foundation

struct PriceHistoryData: Codable {
    let listingId: Int
    let dataPoints: [PricePoint]
}
