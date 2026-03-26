import SwiftUI

/// Shared input bar wrapper used by both empty and conversation states.
struct CopilotInputBarContainer: View {
    @Bindable var viewModel: CopilotViewModel
    let appState: AppState

    var body: some View {
        CopilotInputBar(
            text: $viewModel.inputText,
            isStreaming: viewModel.isStreaming,
            onSend: { Task { await viewModel.send(using: appState) } },
            onStop: { viewModel.stop() }
        )
        .frame(maxWidth: Theme.Copilot.composerMaxWidth)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, Theme.Copilot.horizontalPadding)
    }
}
