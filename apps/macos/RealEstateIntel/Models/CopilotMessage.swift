import Foundation

// MARK: - Message

/// A single message in the copilot conversation.
struct CopilotMessage: Identifiable {
    let id: UUID
    let role: MessageRole
    var contentBlocks: [ContentBlock]
    let timestamp: Date
    var isStreaming: Bool

    init(role: MessageRole, contentBlocks: [ContentBlock], isStreaming: Bool = false) {
        self.id = UUID()
        self.role = role
        self.contentBlocks = contentBlocks
        self.timestamp = Date()
        self.isStreaming = isStreaming
    }

    enum MessageRole: String, Codable {
        case user
        case assistant
    }
}

// MARK: - Content Block

/// Rich content block rendered within a copilot message.
/// Wraps content with a stable UUID for SwiftUI identity.
struct ContentBlock: Identifiable {
    let id: UUID
    let content: ContentBlockType

    init(_ content: ContentBlockType) {
        self.id = UUID()
        self.content = content
    }

    init(id: UUID, content: ContentBlockType) {
        self.id = id
        self.content = content
    }
}

/// The actual content variants for a copilot message block.
enum ContentBlockType {
    case text(String)
    case listingCards([CopilotListing])
    case comparisonTable(ComparisonTableData)
    case scoreBreakdown(ScoreBreakdownData)
    case priceHistory(PriceHistoryData)
    case chartData(ChartBlockData)
    case marketStats([StatItem])
    case loading(String)
}

// MARK: - Copilot Listing

/// Listing data returned by the copilot API (snake_case JSON mapped to camelCase Swift).
struct CopilotListing: Identifiable, Codable, Hashable {
    let id: Int
    let title: String
    let districtNo: Int?
    let districtName: String?
    let priceEur: Int
    let areaSqm: Double?
    let rooms: Double?
    let pricePerSqmEur: Double?
    let score: Double?
    let canonicalUrl: String?
    let sourceCode: String?
    let priceTrendPct: Double?
}

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

// MARK: - Suggested Query

struct SuggestedQuery: Identifiable {
    let label: String
    let query: String

    var id: String { label }
}
