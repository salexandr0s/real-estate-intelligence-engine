import SwiftUI

/// Structured starter actions for a new Copilot research session.
struct CopilotSuggestionChips: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let suggestions: [SuggestedQuery]
    let onSelect: (String) -> Void

    @State private var hoveredId: String?

    private let columns = [
        GridItem(.adaptive(minimum: 260, maximum: 340), spacing: Theme.Spacing.lg),
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: Theme.Spacing.lg) {
            ForEach(suggestions) { suggestion in
                let isHovered = hoveredId == suggestion.id

                Button {
                    onSelect(suggestion.query)
                } label: {
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        HStack(spacing: Theme.Spacing.sm) {
                            Image(systemName: suggestion.icon)
                                .font(.callout.weight(.semibold))
                                .foregroundStyle(Color.accentColor)
                                .frame(width: 30, height: 30)
                                .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.Radius.md))

                            Text(suggestion.label)
                                .font(.subheadline)
                                .adaptiveFontWeight(.semibold)
                                .foregroundStyle(.primary)

                            Spacer(minLength: 0)

                            if isHovered {
                                Image(systemName: "arrow.up.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                            }
                        }

                        Text(suggestion.subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)

                        Text(suggestion.query)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
                    .padding(Theme.Spacing.lg)
                }
                .buttonStyle(.plain)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Copilot.composerRadius)
                        .fill(
                            isHovered
                                ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.1)
                                : Theme.inputBarBackground.opacity(0.5)
                        )
                )
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.Copilot.composerRadius)
                        .strokeBorder(
                            Color(nsColor: .separatorColor).opacity(isHovered ? 0.28 : 0.18),
                            lineWidth: 0.5
                        )
                }
                .contentShape(RoundedRectangle(cornerRadius: Theme.Copilot.composerRadius))
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.14), value: isHovered)
                .onHover { hovering in
                    withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.14)) {
                        hoveredId = hovering ? suggestion.id : nil
                    }
                }
            }
        }
    }
}
