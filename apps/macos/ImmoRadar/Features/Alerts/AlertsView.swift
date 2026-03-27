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
            VStack(spacing: 0) {
                AlertsFilterBar(viewModel: viewModel)
                Divider()

                if let error = viewModel.errorMessage {
                    errorBanner(error)
                    Divider()
                }

                if viewModel.visibleAlerts.isEmpty && !viewModel.isLoading {
                    AlertsEmptyState(
                        scope: viewModel.scope,
                        hasAnyAlerts: viewModel.hasAnyAlerts,
                        hasSearch: !viewModel.searchText.isEmpty,
                        onClearSearch: { searchText = "" },
                        onSwitchToAll: { viewModel.scope = .all },
                        onOpenFilters: { appState.navigateTo(.filters) },
                        onRefresh: {
                            Task {
                                await viewModel.refresh(using: appState.apiClient)
                                await appState.refreshUnreadCount()
                            }
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
                        appState.deepLinkListingId = listingId
                        appState.navigateTo(.listings)
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
                    Task {
                        await viewModel.refresh(using: appState.apiClient)
                        await appState.refreshUnreadCount()
                    }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .help("Refresh alerts")
            }
        }
        .task {
            await viewModel.refresh(using: appState.apiClient)
            await appState.refreshUnreadCount()
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

    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.yellow)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text("Couldn’t load alerts.")
                    .font(.callout.weight(.semibold))
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()

            Button("Dismiss") {
                viewModel.clearError()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)

            Button("Retry") {
                Task {
                    await viewModel.refresh(using: appState.apiClient)
                    await appState.refreshUnreadCount()
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Color.red.opacity(0.08))
    }
}

#Preview {
    AlertsView()
        .environment(AppState())
        .frame(width: 900, height: 600)
}
