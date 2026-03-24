import SwiftUI

struct AlertsList: View {
    @Bindable var viewModel: AlertsViewModel
    let appState: AppState
    var undoManager: UndoManager?

    var body: some View {
        List(viewModel.filteredAlerts, selection: $viewModel.selectedAlertID) { alert in
            AlertRow(alert: alert)
                .tag(alert.id)
                .contextMenu {
                    if alert.status == .unread {
                        Button {
                            Task { await viewModel.markAsRead(alert, using: appState.apiClient) }
                        } label: {
                            Label("Mark as Read", systemImage: "envelope.open")
                        }
                    }

                    if alert.status != .dismissed {
                        Button {
                            Task { await viewModel.dismiss(alert, using: appState.apiClient, undoManager: undoManager) }
                        } label: {
                            Label("Dismiss", systemImage: "xmark.circle")
                        }
                    }
                }
        }
        .listStyle(.inset(alternatesRowBackgrounds: true))
    }
}
