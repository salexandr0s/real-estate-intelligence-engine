import SwiftUI

/// Structured starter actions for a new Copilot research session.
struct CopilotSuggestionChips: View {
    let suggestions: [SuggestedQuery]
    let onSelect: (String) -> Void

    @State private var hoveredId: String?

    private let columns = [
        GridItem(.flexible(), spacing: Theme.Spacing.lg),
        GridItem(.flexible(), spacing: Theme.Spacing.lg),
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: Theme.Spacing.lg) {
            ForEach(suggestions) { suggestion in
                Button {
                    onSelect(suggestion.query)
                } label: {
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        HStack(spacing: Theme.Spacing.sm) {
                            Image(systemName: suggestion.icon)
                                .font(.body)
                                .foregroundStyle(Color.accentColor)
                            Text(suggestion.label)
                                .font(.subheadline)
                                .adaptiveFontWeight(.semibold)
                                .foregroundStyle(.primary)
                            Spacer(minLength: 0)
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
                    RoundedRectangle(cornerRadius: Theme.Radius.lg)
                        .fill(
                            hoveredId == suggestion.id
                                ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.12)
                                : Theme.cardBackground
                        )
                )
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.Radius.lg)
                        .strokeBorder(Color(nsColor: .separatorColor).opacity(0.5), lineWidth: 0.5)
                }
                .shadow(
                    color: .black.opacity(hoveredId == suggestion.id ? 0.08 : 0.04),
                    radius: hoveredId == suggestion.id ? 6 : Theme.cardShadowRadius,
                    y: hoveredId == suggestion.id ? 2 : Theme.cardShadowY
                )
                .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                .onHover { isHovered in
                    hoveredId = isHovered ? suggestion.id : nil
                }
            }
        }
    }
}
