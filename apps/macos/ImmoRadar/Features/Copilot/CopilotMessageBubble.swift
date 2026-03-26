import SwiftUI

/// Renders a Copilot exchange as research notes rather than chat bubbles.
struct CopilotMessageBubble: View {
    let message: CopilotMessage
    let onListingTap: (Int) -> Void

    var body: some View {
        switch message.role {
        case .user:
            UserPromptCard(contentBlocks: message.contentBlocks, timestamp: message.timestamp)
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

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Label("Prompt", systemImage: "person.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(PriceFormatter.relativeDate(timestamp))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            ForEach(contentBlocks) { block in
                if case .text(let text) = block.content {
                    Text(text)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(Theme.Spacing.lg)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(Color(nsColor: .separatorColor).opacity(0.5), lineWidth: 0.5)
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
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            HStack {
                Label("ImmoRadar analysis", systemImage: "sparkles.rectangle.stack")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if renderedArtifactCount > 0 {
                    Text("\(renderedArtifactCount) artifact\(renderedArtifactCount == 1 ? "" : "s")")
                        .font(.caption2.bold())
                        .padding(.horizontal, Theme.Spacing.xs)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.1), in: Capsule())
                }
                Spacer()
                Text(PriceFormatter.relativeDate(timestamp))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            ForEach(Array(contentBlocks.enumerated()), id: \.element.id) { index, block in
                if index > 0 {
                    Divider()
                        .overlay(Color(nsColor: .separatorColor).opacity(0.25))
                }

                ContentBlockView(
                    block: block,
                    isStreaming: isStreaming,
                    onListingTap: onListingTap
                )
            }
        }
        .padding(Theme.Spacing.lg)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(Color(nsColor: .separatorColor).opacity(0.35), lineWidth: 0.5)
        }
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
