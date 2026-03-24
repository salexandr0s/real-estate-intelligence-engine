import SwiftUI

/// Scrollable list of copilot messages with auto-scroll to bottom.
struct CopilotMessageList: View {
    let messages: [CopilotMessage]
    let isStreaming: Bool
    let onListingTap: (Int) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Theme.Spacing.lg) {
                    ForEach(messages) { message in
                        CopilotMessageBubble(
                            message: message,
                            onListingTap: onListingTap
                        )
                        .id(message.id)
                    }
                }
                .padding(Theme.Spacing.xl)
            }
            .onChange(of: messages.last?.id) { _, newID in
                guard let newID else { return }
                withAdaptiveAnimation(reduceMotion, .easeOut(duration: 0.2)) {
                    proxy.scrollTo(newID, anchor: .bottom)
                }
            }
            .onChange(of: messages.last?.contentBlocks.count) { _, _ in
                guard let lastID = messages.last?.id else { return }
                withAdaptiveAnimation(reduceMotion, .easeOut(duration: 0.2)) {
                    proxy.scrollTo(lastID, anchor: .bottom)
                }
            }
        }
    }
}
