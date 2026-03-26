import SwiftUI

/// Top-level copilot research workspace with threaded history and optional listing inspector.
struct CopilotView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = CopilotViewModel()
    @State private var showInspector: Bool = false
    @State private var showRenameSheet = false
    @State private var renameDraft = ""
    @State private var renameTargetID: UUID?

    var body: some View {
        HSplitView {
            CopilotHistorySidebar(
                viewModel: viewModel,
                onSelectConversation: { id in
                    Task { await viewModel.selectConversation(id: id) }
                },
                onRenameConversation: { summary in
                    renameTargetID = summary.id
                    renameDraft = summary.title
                    showRenameSheet = true
                },
                onDeleteConversation: { summary in
                    Task { await viewModel.deleteConversation(id: summary.id) }
                }
            )
            .frame(minWidth: 240, idealWidth: 280, maxWidth: 320)
            .background(Color(nsColor: .underPageBackgroundColor))

            VStack(spacing: 0) {
                CopilotWorkspaceHeader(
                    title: viewModel.activeConversationTitle ?? "Copilot Workspace",
                    subtitle: viewModel.messages.isEmpty
                        ? "Ask focused research questions, review rendered analysis, and keep conversations as reusable working sessions."
                        : "A persistent research thread for market questions, listing analysis, and rendered evidence.",
                    canRename: viewModel.activeConversationID != nil,
                    canDelete: viewModel.activeConversationID != nil,
                    onRename: {
                        renameTargetID = viewModel.activeConversationID
                        renameDraft = viewModel.activeConversationTitle ?? ""
                        showRenameSheet = true
                    },
                    onDelete: {
                        if let id = viewModel.activeConversationID {
                            Task { await viewModel.deleteConversation(id: id) }
                        }
                    }
                )

                Divider()

                Group {
                    if viewModel.messages.isEmpty {
                        CopilotEmptyStateContainer(viewModel: viewModel, appState: appState)
                    } else {
                        CopilotConversationContainer(
                            viewModel: viewModel,
                            appState: appState,
                            showInspector: $showInspector
                        )
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(nsColor: .windowBackgroundColor))
            }
            .frame(minWidth: 540, maxWidth: .infinity, maxHeight: .infinity)

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
                .frame(minWidth: 300, idealWidth: 360, maxWidth: 480, maxHeight: .infinity)
                .adaptiveMaterial(.regularMaterial)
            }
        }
        .navigationTitle("Copilot")
        .toolbar(id: "copilot") {
            ToolbarItem(id: "newChat", placement: .primaryAction) {
                Button {
                    viewModel.beginNewConversation()
                    showInspector = false
                } label: {
                    Label("New Session", systemImage: "square.and.pencil")
                }
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
        .task {
            await viewModel.loadSavedStateIfNeeded()
        }
        .sheet(isPresented: $showRenameSheet) {
            RenameConversationSheet(
                title: $renameDraft,
                onCancel: { showRenameSheet = false },
                onSave: {
                    Task {
                        if let targetID = renameTargetID, targetID != viewModel.activeConversationID {
                            await viewModel.selectConversation(id: targetID)
                        }
                        await viewModel.renameActiveConversation(to: renameDraft)
                        showRenameSheet = false
                        renameTargetID = nil
                    }
                }
            )
        }
    }
}

private struct CopilotHistorySidebar: View {
    @Bindable var viewModel: CopilotViewModel
    let onSelectConversation: (UUID) -> Void
    let onRenameConversation: (CopilotConversationSummary) -> Void
    let onDeleteConversation: (CopilotConversationSummary) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Research Sessions")
                        .font(.headline)
                    Text("Persistent local history")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    viewModel.beginNewConversation()
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(.borderless)
                .help("Start a new session")
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.vertical, Theme.Spacing.md)

            Divider()

            if viewModel.conversations.isEmpty {
                ContentUnavailableView {
                    Label("No Saved Sessions", systemImage: "clock.arrow.circlepath")
                } description: {
                    Text("Your research sessions will appear here after your first prompt.")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, Theme.Spacing.md)
            } else {
                List(selection: Binding(
                    get: { viewModel.activeConversationID },
                    set: { newValue in
                        if let id = newValue {
                            onSelectConversation(id)
                        }
                    }
                )) {
                    ForEach(viewModel.conversations) { summary in
                        ConversationHistoryRow(
                            summary: summary,
                            isActive: summary.id == viewModel.activeConversationID
                        )
                        .tag(Optional(summary.id))
                        .contextMenu {
                            Button {
                                onRenameConversation(summary)
                            } label: {
                                Label("Rename Session", systemImage: "pencil")
                            }

                            Button(role: .destructive) {
                                onDeleteConversation(summary)
                            } label: {
                                Label("Delete Session", systemImage: "trash")
                            }
                        }
                    }
                }
                .listStyle(.sidebar)
            }
        }
    }
}

private struct ConversationHistoryRow: View {
    let summary: CopilotConversationSummary
    let isActive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                Text(summary.title)
                    .font(.subheadline)
                    .adaptiveFontWeight(isActive ? .semibold : .medium)
                    .lineLimit(1)
                Spacer(minLength: Theme.Spacing.sm)
                Text(PriceFormatter.relativeDate(summary.updatedAt))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Text(summary.preview)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            Text("\(summary.messageCount) messages")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, Theme.Spacing.xxs)
    }
}

private struct CopilotWorkspaceHeader: View {
    let title: String
    let subtitle: String
    let canRename: Bool
    let canDelete: Bool
    let onRename: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.lg) {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Text(title)
                    .font(.title2)
                    .adaptiveFontWeight(.semibold)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: Theme.Spacing.lg)

            HStack(spacing: Theme.Spacing.sm) {
                Button("Rename", systemImage: "pencil", action: onRename)
                    .disabled(!canRename)
                Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
                    .disabled(!canDelete)
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, Theme.Spacing.xl)
        .padding(.vertical, Theme.Spacing.lg)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

private struct RenameConversationSheet: View {
    @Binding var title: String
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            Text("Rename Session")
                .font(.headline)

            TextField("Session title", text: $title)
                .textFieldStyle(.roundedBorder)

            HStack {
                Spacer()
                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button("Save", action: onSave)
                    .keyboardShortcut(.defaultAction)
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(Theme.Spacing.xl)
        .frame(width: 360)
    }
}
