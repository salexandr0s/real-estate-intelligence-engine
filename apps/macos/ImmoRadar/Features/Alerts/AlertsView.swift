import SwiftUI

/// Alerts view with status filtering, list, and HSplitView inspector.
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

                if viewModel.filteredAlerts.isEmpty && !viewModel.isLoading {
                    AlertsEmptyState(hasFilter: viewModel.filterStatus != nil)
                } else {
                    AlertsList(
                        viewModel: viewModel,
                        appState: appState,
                        undoManager: undoManager
                    )
                }
            }
            .frame(minWidth: 400)

            if showInspector {
                AlertInspectorContent(alert: viewModel.selectedAlert)
                    .frame(minWidth: 280, idealWidth: 340, maxWidth: 460)
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
            ToolbarItem(id: "markAllRead", placement: .automatic) {
                Button {
                    Task { await viewModel.markAllRead(using: appState.apiClient) }
                } label: {
                    Label("Mark All Read", systemImage: "envelope.open")
                }
                .disabled(viewModel.unreadCount == 0)
            }
            ToolbarItem(id: "dismissAll", placement: .automatic) {
                Button {
                    showDismissConfirmation = true
                } label: {
                    Label("Dismiss All", systemImage: "xmark.circle")
                }
                .disabled(viewModel.alerts.isEmpty)
                .confirmationDialog("Dismiss All Alerts", isPresented: $showDismissConfirmation) {
                    Button("Dismiss All", role: .destructive) {
                        Task { await viewModel.dismissAll(using: appState.apiClient) }
                    }
                } message: {
                    Text("This will dismiss all alerts. This action cannot be undone.")
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
                    Task { await viewModel.refresh(using: appState.apiClient) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .help("Refresh alerts")
            }
        }
        .task {
            await viewModel.refresh(using: appState.apiClient)
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
                Task { await viewModel.dismiss(alert, using: appState.apiClient, undoManager: undoManager) }
            }
        }
    }
}

#Preview {
    AlertsView()
        .environment(AppState())
        .frame(width: 900, height: 600)
}
