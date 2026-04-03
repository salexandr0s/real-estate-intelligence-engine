import Foundation

struct ChartBlockData: Codable {
    let chartType: ChartType
    let title: String
    let series: [ChartSeries]

    enum ChartType: String, Codable {
        case line
        case bar
    }
}
