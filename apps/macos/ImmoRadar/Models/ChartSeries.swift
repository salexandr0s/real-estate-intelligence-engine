import Foundation

struct ChartSeries: Codable, Identifiable {
    let label: String
    let dataPoints: [ChartDataPoint]

    var id: String { label }
}
