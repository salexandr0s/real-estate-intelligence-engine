import SwiftUI

/// Detail content switching on the selected navigation item.
struct DetailContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        switch appState.selectedNavItem {
        case .dashboard:
            DashboardView()
        case .listings:
            ListingsView()
        case .filters:
            FiltersView()
        case .copilot:
            CopilotView()
        case .alerts:
            AlertsView()
        case .watchlist:
            WatchlistView()
        case .outreach:
            OutreachInboxView()
        case .sources:
            SourcesView()
        case .analytics:
            AnalyticsView()
        case .settings:
            SettingsView()
        }
    }
}


private struct OutreachInboxView: View {
    @Environment(AppState.self) private var appState
    @State private var mailboxes: [MailboxAccount] = []
    @State private var threads: [OutreachThreadSummary] = []
    @State private var selectedThread: OutreachThread?
    @State private var isLoading: Bool = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationSplitView {
            List(selection: .constant(selectedThread?.id)) {
                if !mailboxes.isEmpty {
                    Section("Mailbox") {
                        ForEach(mailboxes) { mailbox in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(mailbox.displayName ?? mailbox.email)
                                    .font(.subheadline.weight(.semibold))
                                Text(mailbox.syncStatus.capitalized)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section("Open Threads") {
                    ForEach(threads) { thread in
                        Button {
                            Task { await loadThread(thread.id) }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(thread.contactCompany ?? thread.contactName ?? thread.contactEmail)
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    if thread.unreadInboundCount > 0 {
                                        Text("\(thread.unreadInboundCount)")
                                            .font(.caption2.weight(.bold))
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Color.accentColor.opacity(0.15), in: Capsule())
                                    }
                                }
                                Text(thread.contactEmail)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(thread.workflowState.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .overlay {
                if isLoading && threads.isEmpty { ProgressView("Loading outreach…") }
            }
        } detail: {
            if let selectedThread {
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                        Text(selectedThread.contactCompany ?? selectedThread.contactName ?? selectedThread.contactEmail)
                            .font(.title2.weight(.semibold))
                        Text(selectedThread.workflowState.replacingOccurrences(of: "_", with: " ").capitalized)
                            .foregroundStyle(.secondary)

                        ForEach(selectedThread.messages) { message in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(message.direction.capitalized)
                                        .font(.caption.weight(.semibold))
                                    Spacer()
                                    Text(PriceFormatter.formatDateTime(message.occurredAt))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text(message.subject).font(.headline)
                                if let body = message.bodyText, !body.isEmpty {
                                    Text(body)
                                        .font(.body)
                                        .textSelection(.enabled)
                                }
                            }
                            .padding()
                            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                    .padding(Theme.Spacing.lg)
                }
            } else if let errorMessage {
                ContentUnavailableView("Outreach unavailable", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
            } else {
                ContentUnavailableView("No outreach selected", systemImage: "envelope.badge")
            }
        }
        .task { await refresh() }
        .toolbar {
            Button("Sync Mailbox") {
                Task { await syncFirstMailbox() }
            }
            .disabled(mailboxes.isEmpty)
        }
    }

    private func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            mailboxes = try await appState.apiClient.fetchMailboxes()
            let result = try await appState.apiClient.fetchOutreachThreads()
            threads = result.threads
            if let first = threads.first, selectedThread == nil {
                await loadThread(first.id)
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadThread(_ id: Int) async {
        do {
            selectedThread = try await appState.apiClient.fetchOutreachThread(id: id)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func syncFirstMailbox() async {
        guard let mailbox = mailboxes.first else { return }
        do {
            try await appState.apiClient.syncMailbox(id: mailbox.id)
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
