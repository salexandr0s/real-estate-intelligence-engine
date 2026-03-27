import SwiftUI

/// Renders a Copilot exchange in a calmer, evidence-first workspace presentation.
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
            UserPromptNote(contentBlocks: message.contentBlocks, timestamp: message.timestamp)
                .frame(maxWidth: Theme.Copilot.promptMaxWidth, alignment: .leading)
        case .assistant:
            AssistantResearchSection(
                contentBlocks: message.contentBlocks,
                isStreaming: message.isStreaming,
                timestamp: message.timestamp,
                onListingTap: onListingTap
            )
        }
    }
}

private struct UserPromptNote: View {
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
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(spacing: Theme.Spacing.sm) {
                Text("Question")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                Spacer()

                Text(PriceFormatter.relativeDate(timestamp))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                ForEach(Array(textBlocks.enumerated()), id: \.offset) { _, text in
                    Text(text)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .lineSpacing(3)
                }
            }
        }
        .copilotArtifactCard(padding: Theme.Spacing.lg)
    }
}

private struct AssistantResearchSection: View {
    let contentBlocks: [ContentBlock]
    let isStreaming: Bool
    let timestamp: Date
    let onListingTap: (Int) -> Void

    private var narrativeBlocks: [ContentBlock] {
        contentBlocks.filter {
            if case .text = $0.content { return true }
            return false
        }
    }

    private var evidenceBlocks: [ContentBlock] {
        contentBlocks.filter {
            switch $0.content {
            case .text, .loading:
                return false
            default:
                return true
            }
        }
    }

    private var loadingLabel: String? {
        contentBlocks.compactMap { block -> String? in
            if case .loading(let label) = block.content {
                return label
            }
            return nil
        }.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Copilot.evidenceSpacing) {
            header

            if !narrativeBlocks.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    ForEach(Array(narrativeBlocks.enumerated()), id: \.element.id) { index, block in
                        ContentBlockView(
                            block: block,
                            isStreaming: isStreaming && index == narrativeBlocks.indices.last,
                            onListingTap: onListingTap
                        )
                    }
                }
                .copilotArtifactCard(padding: Theme.Spacing.lg)
            }

            if !evidenceBlocks.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Copilot.evidenceSpacing) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Rendered evidence")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)

                        Spacer()

                        Text("\(evidenceBlocks.count) block\(evidenceBlocks.count == 1 ? "" : "s")")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }

                    VStack(alignment: .leading, spacing: Theme.Copilot.evidenceSpacing) {
                        ForEach(evidenceBlocks) { block in
                            ContentBlockView(
                                block: block,
                                isStreaming: false,
                                onListingTap: onListingTap
                            )
                        }
                    }
                }
            }

            if let loadingLabel, narrativeBlocks.isEmpty, evidenceBlocks.isEmpty {
                HStack(spacing: Theme.Spacing.sm) {
                    TypingIndicator()
                    Text(loadingLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .copilotArtifactCard(padding: Theme.Spacing.md)
            }
        }
    }

    private var header: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Text("Analysis")
                .font(.caption.bold())
                .foregroundStyle(.secondary)

            if isStreaming {
                Text("Thinking")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            Text(PriceFormatter.relativeDate(timestamp))
                .font(.caption2)
                .foregroundStyle(.tertiary)
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
