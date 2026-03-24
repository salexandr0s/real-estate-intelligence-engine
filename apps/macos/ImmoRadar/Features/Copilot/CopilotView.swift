import SwiftUI

/// Top-level copilot chat view — ChatGPT-style layout with optional listing inspector.
struct CopilotView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = CopilotViewModel()
    @State private var showInspector: Bool = false

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                if viewModel.messages.isEmpty {
                    emptyState
                } else {
                    conversationState
                }
            }
            .frame(minWidth: 400, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))

            if showInspector {
                Group {
                    if viewModel.isLoadingInspector {
                        ProgressView("Loading listing…")
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if let error = viewModel.inspectorError {
                        ContentUnavailableView {
                            Label("Failed to Load", systemImage: "exclamationmark.triangle")
                        } description: {
                            Text(error)
                        }
                    } else {
                        ListingsInspectorContent(listing: viewModel.inspectedListing)
                    }
                }
                .frame(minWidth: 280, idealWidth: 360, maxWidth: 480, maxHeight: .infinity)
                .adaptiveMaterial(.regularMaterial)
            }
        }
        .navigationTitle("Copilot")
        .toolbar(id: "copilot") {
            ToolbarItem(id: "newChat", placement: .primaryAction) {
                Button {
                    viewModel.clearConversation()
                    showInspector = false
                } label: {
                    Label("New Chat", systemImage: "plus.bubble")
                }
                .disabled(viewModel.messages.isEmpty)
            }
            ToolbarItem(id: "inspector", placement: .automatic) {
                Button {
                    showInspector.toggle()
                } label: {
                    Label("Inspector", systemImage: "sidebar.trailing")
                }
                .help("Toggle listing detail inspector")
            }
        }
    }

    // MARK: - Empty State (bottom-pinned input + suggestions)

    private var emptyState: some View {
        CopilotEmptyState(
            suggestions: viewModel.suggestions,
            onSuggestionSelected: { query in
                viewModel.inputText = query
                Task { await viewModel.send(using: appState) }
            }
        ) {
            inputBar
        }
    }

    // MARK: - Conversation State

    private var conversationState: some View {
        VStack(spacing: 0) {
            CopilotMessageList(
                messages: viewModel.messages,
                isStreaming: viewModel.isStreaming
            ) { listingId in
                showInspector = true
                viewModel.selectListing(id: listingId, using: appState)
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
