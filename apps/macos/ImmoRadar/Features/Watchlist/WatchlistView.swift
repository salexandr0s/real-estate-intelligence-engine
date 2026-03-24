import SwiftUI

/// Watchlist view showing user-saved listings with notes and export.
struct WatchlistView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = WatchlistViewModel()

    var body: some View {
        VStack(spacing: 0) {
            if let error = viewModel.errorMessage {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(Theme.Spacing.md)
                .background(Color.orange.opacity(0.08))
            }

            if viewModel.savedListings.isEmpty && !viewModel.isLoading {
                ContentUnavailableView {
                    Label("No Saved Listings", systemImage: "bookmark")
                } description: {
                    Text("Save listings from the detail view to track them here.")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(viewModel.savedListings) { item in
                    WatchlistRow(item: item) {
                        Task { await viewModel.unsave(listingId: item.listingId, using: appState.apiClient) }
                    }
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .navigationTitle("Watchlist")
        .toolbar {
            ToolbarItemGroup {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }

                Button {
                    Task {
                        if let data = await viewModel.exportCSV(using: appState.apiClient) {
                            exportToFile(data)
                        }
                    }
                } label: {
                    Label("Export CSV", systemImage: "square.and.arrow.up")
                }
                .disabled(viewModel.savedListings.isEmpty)

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
    }

    private func exportToFile(_ data: Data) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "watchlist.csv"
        panel.allowedContentTypes = [.commaSeparatedText]
        panel.begin { result in
            if result == .OK, let url = panel.url {
                try? data.write(to: url)
            }
        }
    }
}

#Preview {
    WatchlistView()
        .environment(AppState())
        .frame(width: 800, height: 600)
}
