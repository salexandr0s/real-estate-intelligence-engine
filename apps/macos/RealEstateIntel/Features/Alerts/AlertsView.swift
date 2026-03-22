import SwiftUI

/// Alerts view with status filtering, list, and HSplitView inspector.
struct AlertsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AlertsViewModel()
    @State private var showInspector: Bool = false

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
                        appState: appState
                    )
                }
            }
            .frame(minWidth: 400)

            if showInspector {
                AlertInspectorContent(alert: viewModel.selectedAlert)
                    .frame(minWidth: 280, idealWidth: 340, maxWidth: 460)
                    .background(.regularMaterial)
            }
        }
        .navigationTitle("Alerts")
        .toolbar {
            ToolbarItemGroup {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }

                if viewModel.unreadCount > 0 {
                    Text("\(viewModel.unreadCount) unread")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Button {
                    showInspector.toggle()
                } label: {
                    Label("Inspector", systemImage: "sidebar.right")
                }

                Button {
                    Task { await viewModel.refresh(using: appState.apiClient) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
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
    }
}

#Preview {
    AlertsView()
        .environment(AppState())
        .frame(width: 900, height: 600)
}
