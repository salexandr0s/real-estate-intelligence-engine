import SwiftUI

/// Top-level copilot research workspace with threaded history and optional listing inspector.
struct CopilotView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var viewModel = CopilotViewModel()
    @State private var availableWidth: CGFloat = Theme.Copilot.inlineInspectorBreakpoint
    @State private var showInspector: Bool = false
    @State private var showHistorySheet: Bool = false
    @State private var showRenameSheet = false
    @State private var renameDraft = ""
    @State private var renameTargetID: UUID?

    private enum LayoutMode {
        case compact
        case standard
        case expanded

        var showsInlineHistory: Bool {
            self != .compact
        }

        var showsInlineInspector: Bool {
            self == .expanded
        }
    }

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
        GeometryReader { proxy in
            let layoutMode = layoutMode(for: proxy.size.width)

            HStack(spacing: 0) {
                if layoutMode.showsInlineHistory {
                    historySidebar
                        .frame(
                            minWidth: Theme.Copilot.railMinWidth,
                            idealWidth: Theme.Copilot.railIdealWidth,
                            maxWidth: Theme.Copilot.railMaxWidth
                        )
                        .transition(.move(edge: .leading).combined(with: .opacity))
                }

                conversationContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(nsColor: .windowBackgroundColor))

                if layoutMode.showsInlineInspector && showInspector {
                    inspectorPanel
                        .frame(minWidth: 300, idealWidth: 360, maxWidth: 420, maxHeight: .infinity)
                        .adaptiveMaterial(.regularMaterial)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: layoutMode)
            .task(id: proxy.size.width) {
                availableWidth = proxy.size.width
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: showInspector)
        .navigationTitle("Copilot")
        .toolbarRole(.editor)
        .toolbar {
            ToolbarItem(id: "sessionTitle", placement: .principal) {
                CopilotToolbarTitleView(title: toolbarTitle, detail: toolbarDetail)
            }

            ToolbarItemGroup(placement: .primaryAction) {
                ToolbarHistoryButton(isVisible: showHistoryButton) {
                    showHistorySheet = true
                }

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
        .sheet(isPresented: $showHistorySheet) {
            historySidebar
                .frame(minWidth: 320, idealWidth: 360, maxWidth: 420, maxHeight: .infinity)
        }
        .sheet(isPresented: inlineInspectorIsUnavailable) {
            NavigationStack {
                inspectorPanel
                    .navigationTitle("Listing Inspector")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") {
                                showInspector = false
                            }
                        }
                    }
            }
            .frame(minWidth: 540, minHeight: 620)
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

    private var showHistoryButton: Bool {
        compactWidthBand == .compact
    }

    private var compactWidthBand: LayoutMode {
        layoutMode(for: availableWidth)
    }

    private var inlineInspectorIsUnavailable: Binding<Bool> {
        Binding(
            get: {
                showInspector && compactWidthBand != .expanded
            },
            set: { isPresented in
                if !isPresented {
                    showInspector = false
                }
            }
        )
    }

    private var historySidebar: some View {
        CopilotHistorySidebar(
            viewModel: viewModel,
            onSelectConversation: { id in
                showHistorySheet = false
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
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: viewModel.activeConversationID)
    }

    @ViewBuilder
    private var conversationContent: some View {
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

    @ViewBuilder
    private var inspectorPanel: some View {
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

    private func layoutMode(for availableWidth: CGFloat) -> LayoutMode {
        if availableWidth < Theme.Copilot.collapsedHistoryBreakpoint {
            return .compact
        }

        if availableWidth < Theme.Copilot.inlineInspectorBreakpoint {
            return .standard
        }

        return .expanded
    }
}

private struct ToolbarHistoryButton: View {
    let isVisible: Bool
    let action: () -> Void

    var body: some View {
        if isVisible {
            Button(action: action) {
                Label("Sessions", systemImage: "sidebar.leading")
            }
            .labelStyle(.iconOnly)
            .help("Show saved sessions")
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
            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text("Research Sessions")
                        .font(.title3)
                        .adaptiveFontWeight(.semibold)
                    Text("Saved locally on this Mac")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.16)) {
                        viewModel.beginNewConversation()
                    }
                } label: {
                    Label("New Session", systemImage: "square.and.pencil")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.top, Theme.Spacing.lg)
            .padding(.bottom, Theme.Spacing.md)

            HStack {
                Text(viewModel.conversations.isEmpty ? "No saved sessions yet" : "\(viewModel.conversations.count) saved")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.bottom, Theme.Spacing.sm)

            Divider()

            if viewModel.conversations.isEmpty {
                ContentUnavailableView {
                    Label("No Saved Sessions", systemImage: "clock.arrow.circlepath")
                } description: {
                    Text("Your research sessions appear here after your first prompt.")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, Theme.Spacing.md)
            } else {
                ScrollView {
                    LazyVStack(spacing: Theme.Spacing.xs) {
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
            Color(nsColor: .selectedContentBackgroundColor).opacity(0.14)
        } else if isHovered {
            Color(nsColor: .controlBackgroundColor)
        } else {
            .clear
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(alignment: .center, spacing: Theme.Spacing.sm) {
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

            Text("\(summary.messageCount) message\(summary.messageCount == 1 ? "" : "s")")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(backgroundColor, in: RoundedRectangle(cornerRadius: Theme.Copilot.historyRowRadius, style: .continuous))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(isActive ? Color.accentColor : .clear)
                .frame(width: 3)
                .padding(.vertical, Theme.Spacing.sm)
        }
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Copilot.historyRowRadius, style: .continuous)
                .strokeBorder(
                    isActive
                        ? Color.accentColor.opacity(0.18)
                        : Color(nsColor: .separatorColor).opacity(isHovered ? 0.22 : 0.12),
                    lineWidth: 0.5
                )
        }
        .contentShape(RoundedRectangle(cornerRadius: Theme.Copilot.historyRowRadius, style: .continuous))
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.14), value: isHovered)
        .onHover { hovered in
            withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.14)) {
                isHovered = hovered
            }
        }
    }
}

private struct CopilotToolbarTitleView: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 2) {
            Text(title)
                .font(.subheadline)
                .adaptiveFontWeight(.semibold)
                .lineLimit(1)
                .contentTransition(.opacity)

            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .contentTransition(.opacity)
        }
        .frame(maxWidth: Theme.Copilot.toolbarChipMaxWidth)
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
