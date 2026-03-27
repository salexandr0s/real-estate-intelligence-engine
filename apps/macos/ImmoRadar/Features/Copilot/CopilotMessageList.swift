import SwiftUI

/// Scrollable list of Copilot research notes with auto-scroll to the latest exchange.
struct CopilotMessageList: View {
    let messages: [CopilotMessage]
    let isStreaming: Bool
    let onListingTap: (Int) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
            GeometryReader { geometry in
                let horizontalPadding = geometry.size.width < Theme.Copilot.collapsedHistoryBreakpoint
                    ? Theme.Spacing.lg
                    : Theme.Copilot.horizontalPadding

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Theme.Copilot.sessionSpacing) {
                        ForEach(messages) { message in
                            CopilotMessageBubble(
                                message: message,
                                onListingTap: onListingTap
                            )
                            .id(message.id)
                        }
                    }
                    .frame(maxWidth: Theme.Copilot.contentMaxWidth, alignment: .leading)
                    .padding(.horizontal, horizontalPadding)
                    .padding(.top, Theme.Spacing.xl)
                    .padding(.bottom, Theme.Spacing.xxxl)
                    .frame(maxWidth: .infinity, alignment: .center)
                }
                .background(Color(nsColor: .windowBackgroundColor))
                .onChange(of: messages.last?.id) { _, newID in
                    guard let newID else { return }
                    withAdaptiveAnimation(reduceMotion, .easeOut(duration: 0.2)) {
                        proxy.scrollTo(newID, anchor: .bottom)
                    }
                }
                .onChange(of: lastMessageScrollKey) { _, newKey in
                    guard newKey != nil else { return }
                    guard let lastID = messages.last?.id else { return }
                    withAdaptiveAnimation(reduceMotion, .easeOut(duration: 0.2)) {
                        proxy.scrollTo(lastID, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var lastMessageScrollKey: String? {
        guard let lastMessage = messages.last else { return nil }
        let blockSignature = lastMessage.contentBlocks
            .map(contentBlockScrollSignature)
            .joined(separator: "|")
        return "\(lastMessage.id.uuidString)|\(lastMessage.isStreaming)|\(blockSignature)"
    }

    private func contentBlockScrollSignature(_ block: ContentBlock) -> String {
        switch block.content {
        case .text(let text), .loading(let text):
            return "\(block.id.uuidString):\(text.count)"
        case .listingCards(let listings):
            return "\(block.id.uuidString):cards:\(listings.count)"
        case .comparisonTable(let data):
            return "\(block.id.uuidString):table:\(data.headers.count):\(data.rows.count)"
        case .scoreBreakdown(let data):
            return "\(block.id.uuidString):score:\(data.components.count)"
        case .priceHistory(let data):
            return "\(block.id.uuidString):history:\(data.dataPoints.count)"
        case .chartData(let data):
            return "\(block.id.uuidString):chart:\(data.series.count)"
        case .marketStats(let items):
            return "\(block.id.uuidString):stats:\(items.count)"
        case .listingComparison(let data):
            return "\(block.id.uuidString):comparison:\(data.listings.count):\(data.sections.count)"
        case .proximitySummary(let data):
            return "\(block.id.uuidString):proximity:\(data.nearest.count):\(data.counts.count)"
        case .crossSourceComparison(let data):
            return "\(block.id.uuidString):sources:\(data.members.count)"
        }
    }
}
