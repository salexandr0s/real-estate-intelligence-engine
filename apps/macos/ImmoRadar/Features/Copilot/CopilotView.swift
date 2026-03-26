import SwiftUI

/// Top-level copilot research workspace with threaded history and optional listing inspector.
struct CopilotView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var viewModel = CopilotViewModel()
    @State private var showInspector: Bool = false
    @State private var showRenameSheet = false
    @State private var renameDraft = ""
    @State private var renameTargetID: UUID?

    private var toolbarTitle: String {
        guard let title = viewModel.activeConversationTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
            return "New session"
        }
        return title
    }

    private var toolbarDetail: String {
        if viewModel.isStreaming { return "Thinking" }
        if showInspector { return "Inspector open" }
        if viewModel.messages.isEmpty { return "Local research workspace" }

        let count = viewModel.messages.count
        return "\(count) message\(count == 1 ? "" : "s")"
    }

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
            .frame(
                minWidth: Theme.Copilot.railMinWidth,
                idealWidth: Theme.Copilot.railIdealWidth,
                maxWidth: Theme.Copilot.railMaxWidth
            )
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: viewModel.activeConversationID)

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
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: showInspector)
        .navigationTitle("Copilot")
        .toolbarRole(.editor)
        .toolbar {
            ToolbarItem(id: "sessionTitle", placement: .principal) {
                CopilotToolbarTitleChip(title: toolbarTitle, detail: toolbarDetail)
            }

            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.18)) {
                        viewModel.beginNewConversation()
                        showInspector = false
                    }
                } label: {
                    Label("New Session", systemImage: "square.and.pencil")
                }
                .labelStyle(.iconOnly)
                .help("Start a new session")

                Button {
                    renameTargetID = viewModel.activeConversationID
                    renameDraft = viewModel.activeConversationTitle ?? ""
                    showRenameSheet = true
                } label: {
                    Label("Rename Session", systemImage: "pencil")
                }
                .labelStyle(.iconOnly)
                .disabled(viewModel.activeConversationID == nil)
                .help("Rename current session")

                Button(role: .destructive) {
                    if let id = viewModel.activeConversationID {
                        Task { await viewModel.deleteConversation(id: id) }
                    }
                } label: {
                    Label("Delete Session", systemImage: "trash")
                }
                .labelStyle(.iconOnly)
                .disabled(viewModel.activeConversationID == nil)
                .help("Delete current session")

                Button {
                    withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.18)) {
                        showInspector.toggle()
                    }
                } label: {
                    Label("Inspector", systemImage: "sidebar.trailing")
                }
                .labelStyle(.iconOnly)
                .help(showInspector ? "Hide listing inspector" : "Show listing inspector")
            }
        }
        .task {
            await viewModel.loadSavedStateIfNeeded()
        }
        .sheet(isPresented: $showRenameSheet) {
            RenameConversationSheet(
                title: $renameDraft,
                onCancel: {
                    showRenameSheet = false
                    renameTargetID = nil
                },
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var viewModel: CopilotViewModel
    let onSelectConversation: (UUID) -> Void
    let onRenameConversation: (CopilotConversationSummary) -> Void
    let onDeleteConversation: (CopilotConversationSummary) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Theme.Spacing.md) {
                HStack(spacing: Theme.Spacing.sm) {
                    Image(systemName: "sparkles")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 28, height: 28)
                        .background(Theme.inputBarBackground.opacity(0.8), in: RoundedRectangle(cornerRadius: Theme.Radius.md))

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Copilot")
                            .font(.title3)
                            .adaptiveFontWeight(.semibold)
                        Text("Persistent local history")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                Button {
                    withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.16)) {
                        viewModel.beginNewConversation()
                    }
                } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                        .frame(width: 30, height: 30)
                        .background(Theme.inputBarBackground.opacity(0.8), in: RoundedRectangle(cornerRadius: Theme.Radius.md))
                }
                .buttonStyle(.plain)
                .help("Start a new session")
                .accessibilityLabel("New Session")
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.top, Theme.Spacing.lg)
            .padding(.bottom, Theme.Spacing.md)

            HStack {
                Text("Research Sessions")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(viewModel.conversations.count)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.bottom, Theme.Spacing.sm)

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
                ScrollView {
                    LazyVStack(spacing: Theme.Spacing.sm) {
                        ForEach(viewModel.conversations) { summary in
                            Button {
                                onSelectConversation(summary.id)
                            } label: {
                                ConversationHistoryRow(
                                    summary: summary,
                                    isActive: summary.id == viewModel.activeConversationID
                                )
                            }
                            .buttonStyle(.plain)
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
                    .padding(Theme.Spacing.md)
                }
            }
        }
        .background(Color(nsColor: .underPageBackgroundColor))
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(Color(nsColor: .separatorColor).opacity(0.5))
                .frame(width: 1)
        }
    }
}

private struct ConversationHistoryRow: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let summary: CopilotConversationSummary
    let isActive: Bool

    @State private var isHovered = false

    private var backgroundColor: Color {
        if isActive {
            Color(nsColor: .selectedContentBackgroundColor).opacity(0.18)
        } else if isHovered {
            Theme.inputBarBackground.opacity(0.82)
        } else {
            Theme.inputBarBackground.opacity(0.46)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .center, spacing: Theme.Spacing.sm) {
                Circle()
                    .fill(isActive ? Color.accentColor : Color.secondary.opacity(isHovered ? 0.28 : 0.18))
                    .frame(width: 6, height: 6)

                Text(summary.title)
                    .font(.subheadline)
                    .adaptiveFontWeight(isActive ? .semibold : .medium)
                    .lineLimit(1)

                Spacer(minLength: Theme.Spacing.sm)
            }

            Text(summary.preview)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            HStack(spacing: Theme.Spacing.sm) {
                Text(PriceFormatter.relativeDate(summary.updatedAt))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Text("•")
                    .foregroundStyle(.tertiary)
                Text("\(summary.messageCount) messages")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(backgroundColor)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .stroke(
                    isActive
                        ? Color.accentColor.opacity(0.22)
                        : Color(nsColor: .separatorColor).opacity(isHovered ? 0.28 : 0.18),
                    lineWidth: 0.5
                )
        }
        .shadow(
            color: .black.opacity(isActive || isHovered ? 0.07 : 0.02),
            radius: isActive || isHovered ? 10 : 4,
            y: isActive || isHovered ? 6 : 2
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .scaleEffect(isHovered && !reduceMotion ? 1.01 : 1)
        .offset(y: isHovered && !reduceMotion ? -1 : 0)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.14), value: isHovered)
        .onHover { hovered in
            withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.14)) {
                isHovered = hovered
            }
        }
    }
}

private struct CopilotToolbarTitleChip: View {
    let title: String
    let detail: String

    private var statusColor: Color {
        detail == "Thinking" ? .accentColor : Color.secondary.opacity(0.5)
    }

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)

            Text(title)
                .font(.subheadline)
                .adaptiveFontWeight(.semibold)
                .lineLimit(1)
                .contentTransition(.opacity)

            Rectangle()
                .fill(Color(nsColor: .separatorColor).opacity(0.45))
                .frame(width: 1, height: 12)

            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .contentTransition(.opacity)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 8)
        .frame(maxWidth: Theme.Copilot.toolbarChipMaxWidth)
        .adaptiveMaterial(.ultraThinMaterial, solid: Theme.inputBarBackground, in: RoundedRectangle(cornerRadius: Theme.Copilot.toolbarChipRadius))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Copilot.toolbarChipRadius)
                .strokeBorder(Color(nsColor: .separatorColor).opacity(0.26), lineWidth: 0.5)
        }
        .help("\(title) — \(detail)")
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
