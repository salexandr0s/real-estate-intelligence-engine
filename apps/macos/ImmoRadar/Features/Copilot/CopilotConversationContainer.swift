import SwiftUI

/// Message list with input bar for the active conversation state.
struct CopilotConversationContainer: View {
    @Bindable var viewModel: CopilotViewModel
    let appState: AppState
    @Binding var showInspector: Bool

    var body: some View {
        CopilotMessageList(
            messages: viewModel.messages,
            isStreaming: viewModel.isStreaming
        ) { listingId in
            showInspector = true
            viewModel.selectListing(id: listingId, using: appState)
        }
        .safeAreaInset(edge: .bottom) {
            CopilotInputBarContainer(viewModel: viewModel, appState: appState)
                .padding(.top, Theme.Spacing.md)
                .padding(.bottom, Theme.Copilot.bottomDockPadding)
                .background {
                    LinearGradient(
                        colors: [
                            Color(nsColor: .windowBackgroundColor).opacity(0),
                            Color(nsColor: .windowBackgroundColor).opacity(0.85),
                            Color(nsColor: .windowBackgroundColor),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
        }
    }
}
