import SwiftUI

/// Empty state for copilot — positioned as a structured research workspace, not a blank chatbot.
struct CopilotEmptyState<InputBar: View>: View {
    let suggestions: [SuggestedQuery]
    let onSuggestionSelected: (String) -> Void
    @ViewBuilder let inputBar: InputBar

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: Theme.Spacing.xxxl)

            VStack(alignment: .leading, spacing: Theme.Spacing.xxl) {
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    Text("Research workspace")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)

                    Text("Start a session")
                        .font(.largeTitle)
                        .adaptiveFontWeight(.semibold)

                    Text("Search listings, compare districts, inspect price changes, and keep rendered evidence with the session while you move across the app.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                CopilotSuggestionChips(suggestions: suggestions, onSelect: onSuggestionSelected)

                Text("Recent sessions stay in the sidebar when space allows.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: Theme.Copilot.contentMaxWidth, alignment: .leading)
            .padding(.horizontal, Theme.Copilot.horizontalPadding)
            .frame(maxWidth: .infinity, alignment: .center)

            Spacer(minLength: Theme.Spacing.xxxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .bottom) {
            inputBar
                .padding(.top, Theme.Spacing.md)
                .padding(.bottom, Theme.Copilot.bottomDockPadding)
                .background {
                    LinearGradient(
                        colors: [
                            Color(nsColor: .windowBackgroundColor).opacity(0),
                            Color(nsColor: .windowBackgroundColor).opacity(0.78),
                            Color(nsColor: .windowBackgroundColor),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
        }
    }
}
