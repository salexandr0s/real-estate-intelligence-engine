import SwiftUI

/// Message list with input bar for the active conversation state.
struct CopilotConversationContainer: View {
    @Bindable var viewModel: CopilotViewModel
    let appState: AppState
    @Binding var showInspector: Bool

    var body: some View {
        VStack(spacing: 0) {
            CopilotMessageList(
                messages: viewModel.messages,
                isStreaming: viewModel.isStreaming
            ) { listingId in
                showInspector = true
                viewModel.selectListing(id: listingId, using: appState)
            }

            CopilotInputBarContainer(viewModel: viewModel, appState: appState)
                .padding(.top, Theme.Spacing.md)
                .padding(.bottom, Theme.Spacing.lg)
        }
    }
}
