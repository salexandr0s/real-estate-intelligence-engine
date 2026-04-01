import SwiftUI

struct AlertsList: View {
    @Bindable var viewModel: AlertsViewModel
    let appState: AppState
    var undoManager: UndoManager?

    var body: some View {
        List(viewModel.visibleAlerts, selection: $viewModel.selectedAlertID) { alert in
            AlertRow(alert: alert)
                .tag(alert.id)
                .listRowInsets(EdgeInsets(top: 3, leading: Theme.Spacing.md, bottom: 3, trailing: Theme.Spacing.md))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .contextMenu {
                    if alert.status == .unread {
                        Button {
                            Task {
                                await viewModel.markAsRead(alert, using: appState.apiClient)
                                await appState.refreshUnreadCount()
                            }
                        } label: {
                            Label("Mark as Read", systemImage: "envelope.open")
                        }
                    }

                    if alert.status != .dismissed {
                        Button {
                            Task {
                                await viewModel.dismiss(alert, using: appState.apiClient, undoManager: undoManager)
                                await appState.refreshUnreadCount()
                            }
                        } label: {
                            Label("Dismiss", systemImage: "xmark.circle")
                        }
                    }
                }
        }
        .listStyle(.inset(alternatesRowBackgrounds: false))
    }
}
