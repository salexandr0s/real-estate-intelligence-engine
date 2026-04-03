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
                        Task {
                            await viewModel.dismiss(alert, using: appState.apiClient, undoManager: undoManager)
                            await appState.refreshUnreadCount()
                        }
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
                if viewModel.unreadCount > 0 {
                    Text("\(viewModel.unreadCount) unread")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("\(viewModel.unreadCount) unread alerts")
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
        .onChange(of: viewModel.selectedAlertID) { _, newValue in
            if newValue != nil {
                showInspector = true
            }
        }
        .onChange(of: appState.alertStream.lastEvent?.id) { _, _ in
            if let alert = appState.alertStream.lastEvent {
                viewModel.insertStreamAlert(alert)
            }
        }
        .onChange(of: searchText) { _, newValue in
            viewModel.searchText = newValue
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
                Task {
                    await viewModel.dismiss(alert, using: appState.apiClient, undoManager: undoManager)
                    await appState.refreshUnreadCount()
                }
            }
        }
    }

    private func reloadAlerts() async {
        await viewModel.refresh(using: appState.apiClient)
        await appState.refreshUnreadCount()
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
            AlertsFilterBar(viewModel: viewModel)
            Divider()

            if let error = viewModel.errorMessage,
               !AppErrorPresentation.isConnectionIssue(message: error) {
                InlineWarningBanner(
                    title: "Couldn’t load alerts.",
                    message: error,
                    actions: [
                        .init("Dismiss") {
                            viewModel.clearError()
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

    @ViewBuilder
    private var content: some View {
        if viewModel.visibleAlerts.isEmpty && !viewModel.isLoading {
            AlertsEmptyState(
                scope: viewModel.scope,
                hasAnyAlerts: viewModel.hasAnyAlerts,
                hasSearch: !viewModel.searchText.isEmpty,
                onClearSearch: { searchText = "" },
                onSwitchToAll: { viewModel.scope = .all },
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
