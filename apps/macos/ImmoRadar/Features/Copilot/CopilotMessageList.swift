import SwiftUI

/// Scrollable list of Copilot research notes with auto-scroll to the latest exchange.
struct CopilotMessageList: View {
    let messages: [CopilotMessage]
    let isStreaming: Bool
    let onListingTap: (Int) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                    ForEach(messages) { message in
                        CopilotMessageBubble(
                            message: message,
                            onListingTap: onListingTap
                        )
                        .id(message.id)
                    }
                }
                .frame(maxWidth: Theme.Copilot.contentMaxWidth, alignment: .leading)
                .padding(.horizontal, Theme.Copilot.horizontalPadding)
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
            .onChange(of: messages.last?.contentBlocks.count) { _, _ in
                guard let lastID = messages.last?.id else { return }
                withAdaptiveAnimation(reduceMotion, .easeOut(duration: 0.2)) {
                    proxy.scrollTo(lastID, anchor: .bottom)
                }
            }
        }
    }
}
