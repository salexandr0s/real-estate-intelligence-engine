import SwiftUI

/// Top-level copilot chat view — ChatGPT-style layout.
struct CopilotView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = CopilotViewModel()

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.messages.isEmpty {
                emptyState
            } else {
                conversationState
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .navigationTitle("Copilot")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    viewModel.clearConversation()
                } label: {
                    Label("New Chat", systemImage: "plus.bubble")
                }
                .disabled(viewModel.messages.isEmpty)
            }
        }
    }

    // MARK: - Empty State (bottom-pinned input + suggestions)

    private var emptyState: some View {
        VStack(spacing: 0) {
            Spacer()

            CopilotSuggestionChips(suggestions: viewModel.suggestions) { query in
                viewModel.inputText = query
                Task { await viewModel.send(using: appState) }
            }
            .padding(.horizontal, Theme.Spacing.xxl)
            .padding(.bottom, Theme.Spacing.lg)

            inputBar
                .padding(.bottom, Theme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Conversation State

    private var conversationState: some View {
        VStack(spacing: 0) {
            CopilotMessageList(
                messages: viewModel.messages,
                isStreaming: viewModel.isStreaming
            ) { listingId in
                appState.deepLinkListingId = listingId
                appState.navigateTo(.listings)
            }

            inputBar
                .padding(.top, Theme.Spacing.md)
                .padding(.bottom, Theme.Spacing.lg)
        }
    }

    // MARK: - Shared Input Bar

    private var inputBar: some View {
        CopilotInputBar(
            text: Bindable(viewModel).inputText,
            isStreaming: viewModel.isStreaming,
            onSend: { Task { await viewModel.send(using: appState) } },
            onStop: { viewModel.stop() }
        )
        .frame(maxWidth: 768)
        .padding(.horizontal, Theme.Spacing.xxl)
    }
}
