import SwiftUI

/// Empty state for copilot — positioned as a structured research workspace, not a blank chatbot.
struct CopilotEmptyState<InputBar: View>: View {
    let suggestions: [SuggestedQuery]
    let onSuggestionSelected: (String) -> Void
    @ViewBuilder let inputBar: InputBar

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxl) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Text("Start a research session")
                    .font(.title2)
                    .adaptiveFontWeight(.semibold)

                Text("Use Copilot to search listings, compare districts, inspect price changes, and review rendered evidence without losing your work when you switch views.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            CopilotSuggestionChips(suggestions: suggestions, onSelect: onSuggestionSelected)

            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Text("Research prompt")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                inputBar
            }

            Spacer(minLength: 0)
        }
        .padding(Theme.Spacing.xxl)
        .frame(maxWidth: 920, maxHeight: .infinity, alignment: .topLeading)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
