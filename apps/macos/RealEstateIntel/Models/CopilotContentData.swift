import Foundation

// MARK: - Comparison Table

struct ComparisonTableData: Codable {
    let headers: [String]
    let rows: [ComparisonRow]
}

struct ComparisonRow: Codable {
    let label: String
    let values: [String]
}

// MARK: - Score Breakdown

struct ScoreBreakdownData: Codable {
    let listingId: Int
    let overall: Double
    let components: [ScoreComponent]
    let discountToDistrictPct: Double?
    let discountToBucketPct: Double?
    let positiveKeywords: [String]?
    let negativeKeywords: [String]?
}

struct ScoreComponent: Codable {
    let name: String
    let score: Double
}

// MARK: - Price History

struct PriceHistoryData: Codable {
    let listingId: Int
    let dataPoints: [PricePoint]
}

struct PricePoint: Codable, Identifiable {
    let date: Date
    let priceEur: Int

    var id: String { "\(date.timeIntervalSince1970)-\(priceEur)" }
}

// MARK: - Chart Data

struct ChartBlockData: Codable {
    let chartType: ChartType
    let title: String
    let series: [ChartSeries]

    enum ChartType: String, Codable {
        case line
        case bar
    }
}

struct ChartSeries: Codable, Identifiable {
    let label: String
    let dataPoints: [ChartDataPoint]

    var id: String { label }
}

struct ChartDataPoint: Codable, Identifiable {
    let label: String
    let value: Double

    var id: String { label }
}

// MARK: - Market Stats

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
