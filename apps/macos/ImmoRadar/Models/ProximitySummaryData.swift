import Foundation

struct ProximitySummaryData: Codable {
    let listingId: Int
    let listingTitle: String
    let status: Status
    let dataSource: DataSource?
    let summary: String
    let listingCoordinate: CopilotCoordinate?
    let nearest: [ProximityNearestItem]
    let counts: [ProximityCountItem]

    enum Status: String, Codable {
        case ok
        case missingCoordinates = "missing_coordinates"
        case noPois = "no_pois"
    }

    enum DataSource: String, Codable {
        case cache
        case live
    }
}
