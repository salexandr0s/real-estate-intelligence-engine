import SwiftUI

/// Renders a single copilot message with role-appropriate styling.
struct CopilotMessageBubble: View {
    let message: CopilotMessage
    let onListingTap: (Int) -> Void

    var body: some View {
        switch message.role {
        case .user:
            userBubble
        case .assistant:
            assistantBubble
        }
    }

    // MARK: - User Bubble

    private var userBubble: some View {
        HStack {
            Spacer(minLength: 80)

            VStack(alignment: .trailing, spacing: Theme.Spacing.xxs) {
                ForEach(message.contentBlocks) { block in
                    if case .text(let text) = block.content {
                        Text(text)
                            .textSelection(.enabled)
                    }
                }
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.vertical, Theme.Spacing.md)
            .background(Color.accentColor)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        }
    }

    // MARK: - Assistant Bubble

    private var assistantBubble: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            // Avatar
            Circle()
                .fill(.purple.opacity(0.15))
                .frame(width: 28, height: 28)
                .overlay(
                    Image(systemName: "sparkle")
                        .font(.caption)
                        .foregroundStyle(.purple)
                )

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                ForEach(message.contentBlocks) { block in
                    contentBlockView(block)
                }
            }

            Spacer(minLength: 40)
        }
    }

    // MARK: - Content Block Dispatch

    @ViewBuilder
    private func contentBlockView(_ block: ContentBlock) -> some View {
        switch block.content {
        case .text(let text):
            TextContentBlock(text: text, isStreaming: message.isStreaming)

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

// MARK: - Typing Indicator

/// Three bouncing dots indicating AI processing.
struct TypingIndicator: View {
    @State private var animate = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(.secondary)
                    .frame(width: 6, height: 6)
                    .scaleEffect(animate ? 1.0 : 0.5)
                    .opacity(animate ? 1.0 : 0.3)
                    .animation(
                        .easeInOut(duration: 0.6)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.2),
                        value: animate
                    )
            }
        }
        .onAppear { animate = true }
    }
}
