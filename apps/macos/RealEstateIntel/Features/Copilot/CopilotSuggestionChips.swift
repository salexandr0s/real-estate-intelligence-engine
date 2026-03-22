import SwiftUI

/// Centered 2×2 grid of quick-query suggestion chips.
struct CopilotSuggestionChips: View {
    let suggestions: [SuggestedQuery]
    let onSelect: (String) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: Theme.Spacing.sm) {
            ForEach(suggestions) { suggestion in
                Button {
                    onSelect(suggestion.query)
                } label: {
                    Text(suggestion.label)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, Theme.Spacing.md)
                        .padding(.vertical, Theme.Spacing.sm)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .tint(.secondary)
            }
        }
        .frame(maxWidth: 480)
    }
}
