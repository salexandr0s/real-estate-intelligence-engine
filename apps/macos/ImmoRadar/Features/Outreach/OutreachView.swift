import AppKit
import SwiftUI

struct OutreachView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = OutreachViewModel()

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                // With nothing loaded, the inbox column below says why instead.
                OutreachMailboxHeader(
                    mailboxes: viewModel.mailboxes,
                    mailboxesLoaded: viewModel.hasLoaded && viewModel.pageErrorMessage == nil,
                    isSyncing: viewModel.isSyncingMailbox,
                    errorMessage: viewModel.syncErrorMessage
                        ?? (listLoadFailed ? nil : appState.screenLoadError(viewModel.pageErrorMessage)),
                    onSync: { Task { await viewModel.syncPrimaryMailbox(using: appState.apiClient) } }
                )

                Divider()

                OutreachScopePicker(scope: scopeSelection)
                    .padding(.horizontal, Theme.Spacing.lg)
                    .padding(.vertical, Theme.Spacing.md)

                Divider()

                if viewModel.isLoadingList && viewModel.threads.isEmpty {
                    OutreachInboxPlaceholder(alignment: .top) {
                        ContentUnavailableView {
                            Label("Loading Outreach", systemImage: "envelope.badge")
                        } description: {
                            Text("Loading mailbox status and active threads…")
                        }
                        .overlay {
                            ProgressView()
                                .controlSize(.large)
                                .offset(y: -54)
                        }
                    }
                } else if listLoadFailed {
                    LoadFailedView(
                        title: "Outreach Didn’t Load",
                        message: appState.screenLoadError(viewModel.pageErrorMessage),
                        onRetry: { Task { await viewModel.refresh(using: appState.apiClient) } }
                    )
                } else if viewModel.threads.isEmpty {
                    OutreachInboxPlaceholder(alignment: .top) {
                        OutreachEmptyListState(scope: viewModel.selectedScope, hasMailbox: !viewModel.mailboxes.isEmpty)
                    }
                } else {
                    OutreachThreadList(viewModel: viewModel, appState: appState)
                }
            }
            .frame(minWidth: 380, idealWidth: 420, maxWidth: 500, maxHeight: .infinity)

            OutreachDetailPane(viewModel: viewModel, appState: appState)
                .frame(minWidth: 420, idealWidth: 760, maxWidth: .infinity)
                .adaptiveMaterial(.regularMaterial)
        }
        .navigationTitle("Outreach")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                if viewModel.isLoadingList || viewModel.isLoadingThread || viewModel.isSyncingMailbox || viewModel.actionInFlight != nil {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .toolbar(id: "outreach") {
            ToolbarItem(id: "refresh", placement: .automatic) {
                Button {
                    Task { await viewModel.refresh(using: appState.apiClient) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(viewModel.isLoadingList)
                .help("Refresh mailbox status and threads")
            }
            ToolbarItem(id: "sync", placement: .automatic) {
                Button {
                    Task { await viewModel.syncPrimaryMailbox(using: appState.apiClient) }
                } label: {
                    Label("Sync Mailbox", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(viewModel.mailboxes.isEmpty || viewModel.isSyncingMailbox)
                .help("Trigger mailbox sync")
            }
        }
        .task {
            guard appState.allowsAutomaticFeatureLoads else { return }
            await viewModel.refresh(using: appState.apiClient)
            await consumePendingDeepLinkIfNeeded()
        }
        .onChange(of: appState.deepLinkOutreachThreadId) { _, newValue in
            guard newValue != nil else { return }
            Task { await consumePendingDeepLinkIfNeeded() }
        }
        .onChange(of: appState.navigationState.refreshGeneration) {
            Task { await viewModel.refresh(using: appState.apiClient) }
        }
    }

    /// The mailbox or thread list didn't load and no threads are loaded from before.
    private var listLoadFailed: Bool {
        viewModel.pageErrorMessage != nil && viewModel.threads.isEmpty && !viewModel.isLoadingList
    }

    /// The picker's scope. Only a pick here reloads the list: opening a thread from a link sets
    /// the scope itself and loads what it needs.
    private var scopeSelection: Binding<OutreachScope> {
        Binding(
            get: { viewModel.selectedScope },
            set: { scope in
                guard scope != viewModel.selectedScope else { return }
                viewModel.selectedScope = scope
                Task { await viewModel.refresh(using: appState.apiClient) }
            }
        )
    }

    private func consumePendingDeepLinkIfNeeded() async {
        guard let threadID = appState.deepLinkOutreachThreadId else { return }
        await viewModel.openThread(id: threadID, using: appState.apiClient)
        appState.deepLinkOutreachThreadId = nil
    }
}

private struct OutreachInboxPlaceholder<Content: View>: View {
    let alignment: Alignment
    let content: Content

    init(alignment: Alignment, @ViewBuilder content: () -> Content) {
        self.alignment = alignment
        self.content = content()
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity)
            .padding(.top, Theme.Spacing.xl)
            .padding(.horizontal, Theme.Spacing.md)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
    }
}

private struct OutreachMailboxHeader: View {
    let mailboxes: [MailboxAccount]
    /// False until the mailbox list loads, so an empty list doesn't read as no mailbox.
    let mailboxesLoaded: Bool
    let isSyncing: Bool
    let errorMessage: String?
    let onSync: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text("Shared mailbox")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(mailboxes.first?.displayName ?? mailboxes.first?.email ?? emptyTitle)
                        .font(.headline)
                }

                Spacer()

                if let mailbox = mailboxes.first {
                    MailboxStatusBadge(status: mailbox.syncStatus)
                }
            }

            if mailboxes.isEmpty {
                if mailboxesLoaded {
                    Text("Configure the shared mailbox to sync outreach replies and send follow-ups.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    ForEach(mailboxes) { mailbox in
                        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                            Text(mailbox.email)
                                .font(.subheadline)
                                .foregroundStyle(.primary)
                            if let lastSuccessfulSyncAt = mailbox.lastSuccessfulSyncAt {
                                Text("Last successful sync: \(PriceFormatter.formatDateTime(lastSuccessfulSyncAt))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("No successful sync recorded yet.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if let lastErrorMessage = mailbox.lastErrorMessage, !lastErrorMessage.isEmpty {
                                Text("Latest issue: \(lastErrorMessage)")
                                    .font(.caption)
                                    .foregroundStyle(.red)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.vertical, Theme.Spacing.xxs)
                    }
                }
            }

            if let errorMessage, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Spacer()
                Button {
                    onSync()
                } label: {
                    Label(isSyncing ? "Syncing…" : "Sync Mailbox", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.borderedProminent)
                .disabled(mailboxes.isEmpty || isSyncing)
            }
        }
        .padding(Theme.Spacing.lg)
    }

    private var emptyTitle: String {
        mailboxesLoaded ? "Mailbox not configured" : "Mailbox status unknown"
    }
}

private struct OutreachScopePicker: View {
    @Binding var scope: OutreachScope

    var body: some View {
        Picker("Thread Scope", selection: $scope) {
            Text("Open").tag(OutreachScope.open)
            Text("Closed").tag(OutreachScope.closed)
            Text("All").tag(OutreachScope.all)
        }
        .pickerStyle(.segmented)
        .accessibilityLabel("Thread scope")
    }
}

private struct OutreachThreadList: View {
    @Bindable var viewModel: OutreachViewModel
    let appState: AppState

    var body: some View {
        List(selection: $viewModel.selectedThreadID) {
            ForEach(viewModel.threads) { thread in
                OutreachThreadRow(thread: thread, isSelected: viewModel.selectedThreadID == thread.id)
                    .tag(thread.id)
                    .contentShape(Rectangle())
            }

            if viewModel.nextCursor != nil {
                OutreachMoreThreadsRow(
                    isLoading: viewModel.isLoadingMoreThreads,
                    errorMessage: viewModel.moreThreadsErrorMessage,
                    onLoadMore: { Task { await viewModel.loadMoreThreads(using: appState.apiClient) } }
                )
                .selectionDisabled()
            }
        }
        .listStyle(.inset(alternatesRowBackgrounds: true))
        .onChange(of: viewModel.selectedThreadID) { _, newValue in
            guard let newValue else { return }
            Task { await viewModel.selectThread(id: newValue, using: appState.apiClient) }
        }
    }
}

/// The last row while the server has more threads than the list shows.
private struct OutreachMoreThreadsRow: View {
    let isLoading: Bool
    let errorMessage: String?
    let onLoadMore: () -> Void

    var body: some View {
        VStack(spacing: Theme.Spacing.xs) {
            if isLoading {
                ProgressView()
                    .controlSize(.small)
            } else {
                Button("Load More Threads", action: onLoadMore)
                    .controlSize(.small)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Spacing.xs)
    }
}

private struct OutreachThreadRow: View {
    let thread: OutreachThreadSummary
    let isSelected: Bool

    private var title: String {
        thread.contactCompany ?? thread.contactName ?? thread.contactEmail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text(title)
                        .font(.body)
                        .adaptiveFontWeight(.medium)
                        .lineLimit(1)
                    Text(thread.contactEmail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: Theme.Spacing.sm)

                if thread.unreadInboundCount > 0 {
                    Text("\(thread.unreadInboundCount)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                        .padding(.horizontal, Theme.Spacing.sm)
                        .padding(.vertical, 4)
                        .background(Color.accentColor.opacity(0.12), in: Capsule())
                }
            }

            HStack(spacing: Theme.Spacing.sm) {
                OutreachWorkflowBadge(state: thread.workflowState)
                Text("Listing #\(thread.listingId)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }

            HStack(spacing: Theme.Spacing.md) {
                if let lastInboundAt = thread.lastInboundAt {
                    Label("Reply \(PriceFormatter.relativeDate(lastInboundAt))", systemImage: "arrow.down.left")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if let lastOutboundAt = thread.lastOutboundAt {
                    Label("Sent \(PriceFormatter.relativeDate(lastOutboundAt))", systemImage: "arrow.up.right")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Label("No send yet", systemImage: "clock")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let nextActionAt = thread.nextActionAt {
                    Label("Next action \(PriceFormatter.relativeDate(nextActionAt))", systemImage: "calendar")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, Theme.Spacing.xs)
        .overlay(alignment: .leading) {
            if isSelected {
                RoundedRectangle(cornerRadius: Theme.Radius.sm)
                    .fill(Color.accentColor.opacity(0.14))
                    .frame(width: 3)
                    .padding(.vertical, 6)
            }
        }
    }
}

private struct OutreachDetailPane: View {
    @Bindable var viewModel: OutreachViewModel
    let appState: AppState

    var body: some View {
        Group {
            if viewModel.isLoadingThread && viewModel.selectedThread == nil {
                ContentUnavailableView {
                    Label("Loading Thread", systemImage: "envelope.open")
                } description: {
                    Text("Fetching the latest outreach details…")
                }
                .overlay {
                    ProgressView()
                        .controlSize(.large)
                        .offset(y: -54)
                }
            } else if let thread = viewModel.selectedThread {
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                        OutreachThreadHeader(
                            thread: thread,
                            listing: viewModel.selectedListing,
                            onOpenInApp: {
                                if let listing = viewModel.selectedListing {
                                    appState.openListing(listing.id)
                                }
                            },
                            onOpenInBrowser: {
                                if let urlString = viewModel.selectedListing?.canonicalUrl,
                                   let url = URL(string: urlString) {
                                    NSWorkspace.shared.open(url)
                                }
                            }
                        )

                        OutreachActionRow(
                            thread: thread,
                            isBusy: viewModel.actionInFlight != nil,
                            onReload: { Task { await viewModel.reloadSelectedThread(using: appState.apiClient) } },
                            onAction: { action in Task { await viewModel.performThreadAction(action, using: appState.apiClient) } },
                            onSendFollowup: { Task { await viewModel.sendFollowup(using: appState.apiClient) } }
                        )

                        if let failure = viewModel.actionFailure {
                            InlineWarningBanner(
                                title: failure.request.failureTitle,
                                message: failure.message,
                                actions: failureActions(for: failure)
                            )
                        }

                        if let detailError = appState.screenLoadError(viewModel.detailErrorMessage) {
                            InlineWarningBanner(
                                title: "Couldn’t reload the thread",
                                message: detailError,
                                actions: [
                                    .init("Try Again") {
                                        Task { await viewModel.reloadSelectedThread(using: appState.apiClient) }
                                    }
                                ]
                            )
                        }

                        OutreachMessageTimeline(messages: thread.messages)
                        OutreachEventTimeline(events: thread.events)
                    }
                    .padding(Theme.Spacing.xl)
                }
            } else if let detailErrorMessage = viewModel.detailErrorMessage {
                ContentUnavailableView(
                    "Thread unavailable",
                    systemImage: "exclamationmark.triangle",
                    description: Text(
                        appState.screenLoadError(detailErrorMessage)
                            ?? "The thread shows here once the server responds."
                    )
                )
            } else if viewModel.pageErrorMessage != nil, viewModel.threads.isEmpty {
                // The inbox column says why the list didn't load.
                ContentUnavailableView("Outreach unavailable", systemImage: "envelope.open", description: Text("Threads show here once the list loads."))
            } else {
                ContentUnavailableView("Select a thread", systemImage: "envelope.open", description: Text("Choose a thread to inspect replies, timeline events, and next actions."))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Try Again shows only when the server couldn't queue the email and kept the thread as it was.
    private func failureActions(for failure: OutreachRequestFailure) -> [InlineWarningBanner.Action] {
        var actions: [InlineWarningBanner.Action] = []
        if failure.canTryAgain {
            actions.append(.init("Try Again", isProminent: true) {
                Task { await viewModel.tryFailedRequestAgain(using: appState.apiClient) }
            })
        }
        actions.append(.init("Dismiss") { viewModel.dismissActionFailure() })
        return actions
    }
}

private struct OutreachThreadHeader: View {
    let thread: OutreachThread
    let listing: Listing?
    let onOpenInApp: () -> Void
    let onOpenInBrowser: () -> Void

    private var headerTitle: String {
        thread.contactCompany ?? thread.contactName ?? thread.contactEmail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(headerTitle)
                        .font(.title2)
                        .adaptiveFontWeight(.semibold)
                    Text(thread.contactEmail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if let contactPhone = thread.contactPhone, !contactPhone.isEmpty {
                        Text(contactPhone)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                OutreachWorkflowBadge(state: thread.workflowState)
            }

            if let listing {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("Linked listing")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(listing.title)
                        .font(.body)
                        .adaptiveFontWeight(.medium)
                    HStack(spacing: Theme.Spacing.sm) {
                        if let districtName = listing.districtName {
                            Label(districtName, systemImage: "mappin")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text(PriceFormatter.format(eur: listing.listPriceEur))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    HStack(spacing: Theme.Spacing.sm) {
                        Button("Open Listing", action: onOpenInApp)
                            .buttonStyle(.bordered)
                        Button("Open in Browser", action: onOpenInBrowser)
                            .buttonStyle(.bordered)
                    }
                }
                .padding(Theme.Spacing.md)
                .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            }

            HStack(spacing: Theme.Spacing.lg) {
                metaBlock(title: "Unread replies", value: thread.unreadInboundCount.formatted())
                metaBlock(title: "Last outbound", value: thread.lastOutboundAt.map(PriceFormatter.formatDateTime) ?? "—")
                metaBlock(title: "Last inbound", value: thread.lastInboundAt.map(PriceFormatter.formatDateTime) ?? "—")
                metaBlock(title: "Next action", value: thread.nextActionAt.map(PriceFormatter.formatDateTime) ?? "—")
            }
        }
        .cardStyle(.subtle, padding: Theme.Spacing.lg, cornerRadius: Theme.Radius.lg)
    }

    private func metaBlock(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline)
                .adaptiveFontWeight(.medium)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct OutreachActionRow: View {
    let thread: OutreachThread
    let isBusy: Bool
    let onReload: () -> Void
    let onAction: (OutreachAction) -> Void
    let onSendFollowup: () -> Void

    var body: some View {
        // Each button is enabled only when the server accepts its request in the thread's state.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Theme.Spacing.sm) {
                reloadButton
                stateButtons
                followupButton
                Spacer()
            }
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                HStack(spacing: Theme.Spacing.sm) {
                    stateButtons
                }
                HStack(spacing: Theme.Spacing.sm) {
                    reloadButton
                    followupButton
                }
            }
        }
    }

    private var reloadButton: some View {
        Button("Reload", action: onReload)
            .buttonStyle(.bordered)
    }

    @ViewBuilder
    private var stateButtons: some View {
        Button("Pause") { onAction(.pause) }
            .buttonStyle(.bordered)
            .disabled(isBusy || !thread.canPause)
        Button("Resume") { onAction(.resume) }
            .buttonStyle(.bordered)
            .disabled(isBusy || !thread.canResume)
        Button("Retry") { onAction(.retry) }
            .buttonStyle(.bordered)
            .disabled(isBusy || !thread.canRetry)
            .help("Queue the unsent email again")
        Button("Close") { onAction(.close) }
            .buttonStyle(.bordered)
            .disabled(isBusy || !thread.canClose)
    }

    private var followupButton: some View {
        Button("Send Follow-Up", action: onSendFollowup)
            .buttonStyle(.borderedProminent)
            .disabled(isBusy || !thread.canSendFollowup)
    }
}

private struct OutreachMessageTimeline: View {
    let messages: [OutreachMessage]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Messages")
                .font(.headline)

            if messages.isEmpty {
                Text("No messages have been captured for this thread yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(messages) { message in
                    let delivery = OutreachDeliveryPresentation.make(for: message.deliveryStatus)

                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                            Label(message.direction == "inbound" ? "Inbound" : "Outbound", systemImage: message.direction == "inbound" ? "arrow.down.left.circle.fill" : "arrow.up.right.circle.fill")
                                .font(.caption.weight(.semibold))
                            Spacer()
                            Text(delivery.title)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(delivery.tint)
                            Text(PriceFormatter.formatDateTime(message.occurredAt))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Text(message.subject)
                            .font(.subheadline)
                            .adaptiveFontWeight(.semibold)

                        if let bodyText = message.bodyText, !bodyText.isEmpty {
                            Text(bodyText)
                                .font(.body)
                                .textSelection(.enabled)
                        } else {
                            Text("No text body available.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        if !message.attachments.isEmpty {
                            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                                Text("Attachments")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                ForEach(message.attachments) { attachment in
                                    HStack(spacing: Theme.Spacing.sm) {
                                        Image(systemName: "paperclip")
                                            .foregroundStyle(.secondary)
                                        Text(attachment.label ?? "Document #\(attachment.documentId)")
                                            .font(.caption)
                                        Spacer()
                                        Text(attachment.status.capitalized)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }

                        if let errorMessage = message.errorMessage, !errorMessage.isEmpty {
                            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                    .padding(Theme.Spacing.md)
                    .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                }
            }
        }
    }
}

private struct OutreachEventTimeline: View {
    let events: [OutreachEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Timeline")
                .font(.headline)

            if events.isEmpty {
                Text("No workflow events recorded yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(events) { event in
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        HStack(alignment: .top) {
                            Text(event.eventType.replacing("_", with: " ").capitalized)
                                .font(.subheadline)
                                .adaptiveFontWeight(.medium)
                            Spacer()
                            Text(PriceFormatter.formatDateTime(event.occurredAt))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        if let fromState = event.fromState, let toState = event.toState {
                            Text("\(OutreachWorkflowPresentation.make(for: fromState).title) → \(OutreachWorkflowPresentation.make(for: toState).title)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        if let payload = event.payload, !payload.isEmpty {
                            Text(payload.map { "\($0.key): \($0.value)" }.sorted().joined(separator: " • "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.vertical, Theme.Spacing.xs)

                    if event.id != events.last?.id {
                        Divider()
                    }
                }
            }
        }
        .padding(Theme.Spacing.md)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
    }
}

private struct OutreachEmptyListState: View {
    let scope: OutreachScope
    let hasMailbox: Bool

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            Text(description)
        }
    }

    private var title: String {
        if !hasMailbox { return "Mailbox not configured" }
        switch scope {
        case .open: return "No open threads"
        case .closed: return "No closed threads"
        case .all: return "No outreach threads"
        }
    }

    private var description: String {
        if !hasMailbox {
            return "Set up the shared mailbox first so Outreach can sync replies and thread state."
        }
        switch scope {
        case .open:
            return "You’re caught up. New outreach threads and unread replies will appear here."
        case .closed:
            return "No closed threads are available in the current mailbox."
        case .all:
            return "Start outreach from a listing to create the first tracked thread."
        }
    }

    private var symbol: String {
        hasMailbox ? "tray" : "envelope.badge"
    }
}

#Preview {
    OutreachView()
        .environment(AppState())
        .frame(width: 1100, height: 700)
}
