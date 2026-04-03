import Foundation

struct ChartDataPoint: Codable, Identifiable {
    let label: String
    let value: Double

    var id: String { label }
}
