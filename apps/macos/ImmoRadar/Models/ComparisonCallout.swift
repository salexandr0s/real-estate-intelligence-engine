import Foundation

struct ComparisonCallout: Codable, Identifiable {
    let label: String
    let detail: String
    let listingId: Int?
    let tone: Tone

    var id: String { "\(label)-\(detail)" }

    enum Tone: String, Codable {
        case positive
        case neutral
        case caution
    }
}
