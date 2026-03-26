import SwiftUI

/// Wraps CopilotEmptyState with the shared input bar for the initial chat state.
struct CopilotEmptyStateContainer: View {
    @Bindable var viewModel: CopilotViewModel
    let appState: AppState

    var body: some View {
        CopilotEmptyState(
            suggestions: viewModel.suggestions,
            onSuggestionSelected: { query in
                viewModel.inputText = query
                Task { await viewModel.send(using: appState) }
            }
        ) {
            CopilotInputBarContainer(viewModel: viewModel, appState: appState)
        }
    }
}
