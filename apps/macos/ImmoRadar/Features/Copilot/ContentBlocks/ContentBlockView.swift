import SwiftUI

/// Routes a content block to the appropriate specialized view.
struct ContentBlockView: View {
    let block: ContentBlock
    let isStreaming: Bool
    let onListingTap: (Int) -> Void

    var body: some View {
        switch block.content {
        case .text(let text):
            TextContentBlock(text: text, isStreaming: isStreaming)

        case .listingCards(let listings):
            ListingCardBlock(listings: listings, onTap: onListingTap)

        case .comparisonTable(let data):
            ComparisonTableBlock(data: data)

        case .scoreBreakdown(let data):
            ScoreBreakdownBlock(data: data)

        case .priceHistory(let data):
            PriceHistoryBlock(data: data)

        case .chartData(let data):
            ChartBlock(data: data)

        case .marketStats(let stats):
            MarketStatsBlock(stats: stats)

        case .listingComparison(let data):
            ListingComparisonBlockView(data: data, onListingTap: onListingTap)

        case .proximitySummary(let data):
            ProximitySummaryBlock(data: data)

        case .crossSourceComparison(let data):
            CrossSourceComparisonBlockView(data: data, onListingTap: onListingTap)

        case .loading(let label):
            HStack(spacing: Theme.Spacing.sm) {
                TypingIndicator()
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
