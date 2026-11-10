import SwiftUI

/// Alerts view with triage-first scope controls, list, and focused inspector.
struct AlertsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.undoManager) private var undoManager
    @State private var viewModel = AlertsViewModel()
    @State private var showInspector: Bool = false
    @State private var showDismissConfirmation: Bool = false
    @State private var searchText = ""

    var body: some View {
        HSplitView {
            AlertsPrimaryPane(
                viewModel: viewModel,
                appState: appState,
                undoManager: undoManager,
                searchText: $searchText,
                onReload: reloadAlerts
            )
            .frame(minWidth: 440)

            if showInspector {
                AlertInspectorContent(
                    alert: viewModel.selectedAlert,
                    onMarkAsRead: {
                        guard let alert = viewModel.selectedAlert else { return }
                        Task {
                            await viewModel.markAsRead(alert, using: appState.apiClient)
                            await appState.refreshUnreadCount()
                        }
                    },
                    onDismiss: {
                        guard let alert = viewModel.selectedAlert else { return }
                        dismiss(alert)
                    },
                    onOpenListing: {
                        guard let listingId = viewModel.selectedAlert?.listingId else { return }
                        appState.openListing(listingId)
                    },
                    onOpenFilters: {
                        appState.navigateTo(.filters)
                    }
                )
                .frame(minWidth: 320, idealWidth: 380, maxWidth: 520)
                .adaptiveMaterial(.regularMaterial)
            }
        }
        .searchable(text: $searchText, placement: .toolbar, prompt: "Search alerts...")
        .navigationTitle("Alerts")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            ToolbarItem(placement: .automatic) {
                let unreadTotal = appState.alertsState.unreadAlertCount
                if unreadTotal > 0 {
                    Text("\(unreadTotal) unread")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("\(unreadTotal) unread alerts")
                }
            }
        }
        .toolbar(id: "alerts") {
            ToolbarItem(id: "markVisibleRead", placement: .automatic) {
                Button {
                    Task {
                        await viewModel.markVisibleRead(using: appState.apiClient)
                        await appState.refreshUnreadCount()
                    }
                } label: {
                    Label("Mark Visible Read", systemImage: "envelope.open")
                }
                .disabled(viewModel.visibleAlerts.allSatisfy { $0.status != .unread })
            }
            ToolbarItem(id: "dismissVisible", placement: .automatic) {
                Button {
                    showDismissConfirmation = true
                } label: {
                    Label("Dismiss Visible", systemImage: "archivebox")
                }
                .disabled(viewModel.visibleAlerts.allSatisfy { $0.status == .dismissed })
                .confirmationDialog("Dismiss Visible Alerts", isPresented: $showDismissConfirmation) {
                    Button("Dismiss Visible", role: .destructive) {
                        Task {
                            await viewModel.dismissVisible(using: appState.apiClient)
                            await appState.refreshUnreadCount()
                        }
                    }
                } message: {
                    Text("This will dismiss the alerts currently visible in the inbox.")
                }
            }
            ToolbarItem(id: "inspector", placement: .automatic) {
                Button {
                    showInspector.toggle()
                } label: {
                    Label("Inspector", systemImage: "sidebar.right")
                }
                .help("Toggle alert detail inspector")
            }
            ToolbarItem(id: "refresh", placement: .automatic) {
                Button {
                    Task { await reloadAlerts() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .help("Refresh alerts")
            }
        }
        .task {
            guard appState.allowsAutomaticFeatureLoads else { return }
            await reloadAlerts()
        }
        .task {
            // Each streamed alert arrives here once, however many come in one main-actor turn.
            for await alert in appState.alertStream.alerts() {
                viewModel.insertStreamAlert(alert)
            }
        }
        .onChange(of: viewModel.selectedAlertID) { _, newValue in
            if newValue != nil {
                showInspector = true
            }
        }
        .onChange(of: appState.navigationState.refreshGeneration) { _, _ in
            Task { await reloadAlerts() }
        }
        .onChange(of: searchText) { _, newValue in
            viewModel.searchText = newValue
        }
        .onChange(of: viewModel.scope) { _, _ in
            Task { await reloadAlerts() }
        }
        .onChange(of: viewModel.userFilterId) { _, _ in
            Task { await reloadAlerts() }
        }
        .onChange(of: viewModel.sortBy) { _, _ in
            Task { await reloadAlerts() }
        }
        .onChange(of: viewModel.sortDirection) { _, _ in
            Task { await reloadAlerts() }
        }
        .onDeleteCommand {
            if let id = viewModel.selectedAlertID,
               let alert = viewModel.alerts.first(where: { $0.id == id }) {
                dismiss(alert)
            }
        }
    }

    private func reloadAlerts() async {
        await viewModel.refresh(using: appState.apiClient)
        await appState.refreshUnreadCount()
    }

    private func dismiss(_ alert: Alert) {
        let appState = appState
        Task {
            await viewModel.dismiss(
                alert,
                using: appState.apiClient,
                undoManager: undoManager,
                afterUndo: { await appState.refreshUnreadCount() }
            )
            await appState.refreshUnreadCount()
        }
    }
}

private struct AlertsPrimaryPane: View {
    @Bindable var viewModel: AlertsViewModel
    let appState: AppState
    let undoManager: UndoManager?
    @Binding var searchText: String
    let onReload: () async -> Void

    var body: some View {
        VStack(spacing: 0) {
            AlertsFilterBar(viewModel: viewModel, unreadTotal: appState.alertsState.unreadAlertCount)
            Divider()

            if let error = viewModel.errorMessage {
                InlineWarningBanner(
                    title: "Couldn’t complete the last alert action.",
                    message: error,
                    actions: [
                        .init("Dismiss") {
                            viewModel.clearError()
                        },
                    ]
                )
                Divider()
            }

            // With nothing loaded, the placeholder below says it instead.
            if let error = appState.screenLoadError(viewModel.loadErrorMessage), !showsLoadFailure {
                InlineWarningBanner(
                    title: "Couldn’t load alerts.",
                    message: error,
                    actions: [
                        .init("Dismiss") {
                            viewModel.clearLoadError()
                        },
                        .init("Retry", systemImage: "arrow.clockwise", isProminent: true) {
                            Task { await onReload() }
                        },
                    ]
                )
                Divider()
            }

            content
        }
    }

    /// The last load failed and nothing in the current scope is loaded from before.
    private var showsLoadFailure: Bool {
        viewModel.loadErrorMessage != nil && viewModel.scopedAlerts.isEmpty && !viewModel.isLoading
    }

    @ViewBuilder
    private var content: some View {
        if showsLoadFailure {
            LoadFailedView(
                title: "Alerts Didn’t Load",
                message: appState.screenLoadError(viewModel.loadErrorMessage),
                onRetry: { Task { await onReload() } }
            )
        } else if viewModel.visibleAlerts.isEmpty && !viewModel.isLoading {
            AlertsEmptyState(
                scope: viewModel.scope,
                hasSearch: !viewModel.searchText.isEmpty,
                hasFilterSelection: viewModel.userFilterId != nil,
                onClearSearch: { searchText = "" },
                onSwitchToAll: { viewModel.scope = .all },
                onShowAllFilters: { viewModel.userFilterId = nil },
                onOpenFilters: { appState.navigateTo(.filters) },
                onRefresh: {
                    Task { await onReload() }
                }
            )
        } else {
            AlertsList(
                viewModel: viewModel,
                appState: appState,
                undoManager: undoManager
            )
        }
    }
}

#Preview {
    AlertsView()
        .environment(AppState())
        .frame(width: 900, height: 600)
}
