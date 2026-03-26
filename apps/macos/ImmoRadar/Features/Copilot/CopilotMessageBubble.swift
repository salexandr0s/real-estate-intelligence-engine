import SwiftUI

/// Renders a Copilot exchange in a calmer, conversation-style presentation.
struct CopilotMessageBubble: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let message: CopilotMessage
    let onListingTap: (Int) -> Void

    @State private var hasAppeared = false

    var body: some View {
        bubbleContent
            .opacity(hasAppeared || reduceMotion ? 1 : 0)
            .offset(y: hasAppeared || reduceMotion ? 0 : 8)
            .onAppear {
                guard !hasAppeared else { return }
                withAdaptiveAnimation(reduceMotion, .easeOut(duration: 0.18)) {
                    hasAppeared = true
                }
            }
    }

    @ViewBuilder
    private var bubbleContent: some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: 72)
                UserPromptCard(contentBlocks: message.contentBlocks, timestamp: message.timestamp)
                    .frame(maxWidth: 560, alignment: .trailing)
            }
        case .assistant:
            AssistantResearchCard(
                contentBlocks: message.contentBlocks,
                isStreaming: message.isStreaming,
                timestamp: message.timestamp,
                onListingTap: onListingTap
            )
        }
    }
}

private struct UserPromptCard: View {
    let contentBlocks: [ContentBlock]
    let timestamp: Date

    private var textBlocks: [String] {
        contentBlocks.compactMap { block in
            if case .text(let text) = block.content {
                return text
            }
            return nil
        }
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: Theme.Spacing.xs) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                ForEach(Array(textBlocks.enumerated()), id: \.offset) { _, text in
                    Text(text)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(Color(nsColor: .controlBackgroundColor).opacity(0.9), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(Color(nsColor: .separatorColor).opacity(0.24), lineWidth: 0.5)
            }

            Text(PriceFormatter.relativeDate(timestamp))
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .padding(.trailing, Theme.Spacing.xs)
        }
    }
}

private struct AssistantResearchCard: View {
    let contentBlocks: [ContentBlock]
    let isStreaming: Bool
    let timestamp: Date
    let onListingTap: (Int) -> Void

    private var renderedArtifactCount: Int {
        contentBlocks.reduce(into: 0) { count, block in
            switch block.content {
            case .text, .loading:
                break
            default:
                count += 1
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(spacing: Theme.Spacing.sm) {
                Image(systemName: "sparkles")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 22, height: 22)
                    .background(Color.accentColor.opacity(0.1), in: Circle())

                Text("Copilot")
                    .font(.caption)
                    .adaptiveFontWeight(.semibold)
                    .foregroundStyle(.secondary)

                if renderedArtifactCount > 0 {
                    Text("\(renderedArtifactCount) artifact\(renderedArtifactCount == 1 ? "" : "s")")
                        .font(.caption2.bold())
                        .padding(.horizontal, Theme.Spacing.xs)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.08), in: Capsule())
                }

                Spacer()

                Text(PriceFormatter.relativeDate(timestamp))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                ForEach(contentBlocks) { block in
                    ContentBlockView(
                        block: block,
                        isStreaming: isStreaming,
                        onListingTap: onListingTap
                    )
                }
            }
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.lg)
        .background(Theme.inputBarBackground.opacity(0.55), in: RoundedRectangle(cornerRadius: Theme.Copilot.composerRadius))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Copilot.composerRadius)
                .strokeBorder(Color(nsColor: .separatorColor).opacity(0.2), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.03), radius: 10, y: 4)
    }
}

/// Three dots indicating work in progress.
struct TypingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
                        reduceMotion
                            ? nil
                            : .easeInOut(duration: 0.6)
                                .repeatForever(autoreverses: true)
                                .delay(Double(index) * 0.2),
                        value: animate
                    )
            }
        }
        .onAppear {
            if !reduceMotion { animate = true }
        }
    }
}
