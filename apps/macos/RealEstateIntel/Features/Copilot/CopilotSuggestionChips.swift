import SwiftUI

/// Centered 2x2 grid of suggestion cards with subtle outlined style.
struct CopilotSuggestionChips: View {
    let suggestions: [SuggestedQuery]
    let onSelect: (String) -> Void

    @State private var hoveredId: String?

    private let columns = [
        GridItem(.flexible(), spacing: Theme.Spacing.md),
        GridItem(.flexible(), spacing: Theme.Spacing.md),
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: Theme.Spacing.md) {
            ForEach(suggestions) { suggestion in
                Button {
                    onSelect(suggestion.query)
                } label: {
                    Text(suggestion.label)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, Theme.Spacing.lg)
                        .padding(.vertical, Theme.Spacing.md)
                }
                .buttonStyle(.plain)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.md)
                        .fill(hoveredId == suggestion.id
                              ? Color(nsColor: .separatorColor).opacity(0.1)
                              : Color.clear)
                )
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.md)
                        .strokeBorder(
                            Color(nsColor: .separatorColor).opacity(hoveredId == suggestion.id ? 0.6 : 0.4),
                            lineWidth: 0.5
                        )
                )
                .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
                .onHover { isHovered in
                    hoveredId = isHovered ? suggestion.id : nil
                }
            }
        }
        .frame(maxWidth: 600)
    }
}
