import Foundation

struct StatItem: Codable, Identifiable {
    let label: String
    let value: String
    let trend: Trend?

    var id: String { label }

    enum Trend: String, Codable {
        case up
        case down
        case flat
    }
}
