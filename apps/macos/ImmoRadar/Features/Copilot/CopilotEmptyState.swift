import SwiftUI

/// Empty state for copilot chat — suggestion chips and bottom-pinned input.
struct CopilotEmptyState<InputBar: View>: View {
    let suggestions: [SuggestedQuery]
    let onSuggestionSelected: (String) -> Void
    @ViewBuilder let inputBar: InputBar

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            CopilotSuggestionChips(suggestions: suggestions, onSelect: onSuggestionSelected)
                .padding(.horizontal, Theme.Spacing.xxl)
                .padding(.bottom, Theme.Spacing.lg)

            inputBar
                .padding(.bottom, Theme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
