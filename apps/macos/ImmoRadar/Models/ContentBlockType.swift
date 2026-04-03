import Foundation

/// The actual content variants for a copilot message block.
enum ContentBlockType: Codable {
    case text(String)
    case listingCards([CopilotListing])
    case comparisonTable(ComparisonTableData)
    case scoreBreakdown(ScoreBreakdownData)
    case priceHistory(PriceHistoryData)
    case chartData(ChartBlockData)
    case marketStats([StatItem])
    case listingComparison(ListingComparisonData)
    case proximitySummary(ProximitySummaryData)
    case crossSourceComparison(CrossSourceComparisonData)
    case loading(String)

    private enum CodingKeys: String, CodingKey {
        case type
        case text
        case listings
        case comparisonTable
        case scoreBreakdown
        case priceHistory
        case chartData
        case marketStats
        case listingComparison
        case proximitySummary
        case crossSourceComparison
        case loading
    }

    private enum BlockType: String, Codable {
        case text
        case listingCards
        case comparisonTable
        case scoreBreakdown
        case priceHistory
        case chartData
        case marketStats
        case listingComparison
        case proximitySummary
        case crossSourceComparison
        case loading
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(BlockType.self, forKey: .type)

        switch type {
        case .text:
            self = .text(try container.decode(String.self, forKey: .text))
        case .listingCards:
            self = .listingCards(try container.decode([CopilotListing].self, forKey: .listings))
        case .comparisonTable:
            self = .comparisonTable(try container.decode(ComparisonTableData.self, forKey: .comparisonTable))
        case .scoreBreakdown:
            self = .scoreBreakdown(try container.decode(ScoreBreakdownData.self, forKey: .scoreBreakdown))
        case .priceHistory:
            self = .priceHistory(try container.decode(PriceHistoryData.self, forKey: .priceHistory))
        case .chartData:
            self = .chartData(try container.decode(ChartBlockData.self, forKey: .chartData))
        case .marketStats:
            self = .marketStats(try container.decode([StatItem].self, forKey: .marketStats))
        case .listingComparison:
            self = .listingComparison(try container.decode(ListingComparisonData.self, forKey: .listingComparison))
        case .proximitySummary:
            self = .proximitySummary(try container.decode(ProximitySummaryData.self, forKey: .proximitySummary))
        case .crossSourceComparison:
            self = .crossSourceComparison(try container.decode(CrossSourceComparisonData.self, forKey: .crossSourceComparison))
        case .loading:
            self = .loading(try container.decode(String.self, forKey: .loading))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .text(let value):
            try container.encode(BlockType.text, forKey: .type)
            try container.encode(value, forKey: .text)
        case .listingCards(let value):
            try container.encode(BlockType.listingCards, forKey: .type)
            try container.encode(value, forKey: .listings)
        case .comparisonTable(let value):
            try container.encode(BlockType.comparisonTable, forKey: .type)
            try container.encode(value, forKey: .comparisonTable)
        case .scoreBreakdown(let value):
            try container.encode(BlockType.scoreBreakdown, forKey: .type)
            try container.encode(value, forKey: .scoreBreakdown)
        case .priceHistory(let value):
            try container.encode(BlockType.priceHistory, forKey: .type)
            try container.encode(value, forKey: .priceHistory)
        case .chartData(let value):
            try container.encode(BlockType.chartData, forKey: .type)
            try container.encode(value, forKey: .chartData)
        case .marketStats(let value):
            try container.encode(BlockType.marketStats, forKey: .type)
            try container.encode(value, forKey: .marketStats)
        case .listingComparison(let value):
            try container.encode(BlockType.listingComparison, forKey: .type)
            try container.encode(value, forKey: .listingComparison)
        case .proximitySummary(let value):
            try container.encode(BlockType.proximitySummary, forKey: .type)
            try container.encode(value, forKey: .proximitySummary)
        case .crossSourceComparison(let value):
            try container.encode(BlockType.crossSourceComparison, forKey: .type)
            try container.encode(value, forKey: .crossSourceComparison)
        case .loading(let value):
            try container.encode(BlockType.loading, forKey: .type)
            try container.encode(value, forKey: .loading)
        }
    }
}
