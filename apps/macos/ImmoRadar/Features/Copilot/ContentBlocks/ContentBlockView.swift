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
            .copilotArtifactCard(padding: Theme.Spacing.md)
        }
    }
}

enum CopilotArtifactTone: Equatable {
    case neutral
    case accent
    case score
    case positive
    case caution

    var tint: Color {
        switch self {
        case .neutral: return .secondary
        case .accent: return .accentColor
        case .score: return .scoreExcellent
        case .positive: return .scoreGood
        case .caution: return .scoreAverage
        }
    }
}

private struct CopilotArtifactCardModifier: ViewModifier {
    var padding: CGFloat
    var cornerRadius: CGFloat
    var tone: CopilotArtifactTone

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
                    .overlay {
                        if tone != .neutral {
                            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                                .fill(tone.tint.opacity(0.04))
                        }
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        tone == .neutral
                            ? Color(nsColor: .separatorColor).opacity(0.18)
                            : tone.tint.opacity(0.14),
                        lineWidth: 0.5
                    )
            }
    }
}

private struct CopilotArtifactInsetModifier: ViewModifier {
    var padding: CGFloat
    var cornerRadius: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Color(nsColor: .separatorColor).opacity(0.16), lineWidth: 0.5)
            }
    }
}

extension View {
    func copilotArtifactCard(
        padding: CGFloat = Theme.Spacing.md,
        cornerRadius: CGFloat = Theme.Copilot.artifactRadius,
        tone: CopilotArtifactTone = .neutral
    ) -> some View {
        modifier(
            CopilotArtifactCardModifier(
                padding: padding,
                cornerRadius: cornerRadius,
                tone: tone
            )
        )
    }

    func copilotArtifactInset(
        padding: CGFloat = Theme.Spacing.md,
        cornerRadius: CGFloat = Theme.Radius.md
    ) -> some View {
        modifier(
            CopilotArtifactInsetModifier(
                padding: padding,
                cornerRadius: cornerRadius
            )
        )
    }
}
