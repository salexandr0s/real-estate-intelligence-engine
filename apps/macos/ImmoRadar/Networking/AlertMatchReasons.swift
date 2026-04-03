import Foundation

struct AlertMatchReasons: Codable, Hashable, Sendable {
    let matchedKeywords: [String]?
    let districtMatch: Bool?
    let thresholdsMet: ThresholdsMet?
    let filterName: String?

    struct ThresholdsMet: Codable, Hashable, Sendable {
        let price: Bool?
        let area: Bool?
        let rooms: Bool?
        let score: Bool?
    }
}
