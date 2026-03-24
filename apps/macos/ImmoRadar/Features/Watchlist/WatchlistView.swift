import SwiftUI

/// Watchlist view showing user-saved listings with notes and export.
struct WatchlistView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.undoManager) private var undoManager
    @State private var viewModel = WatchlistViewModel()
    @State private var searchText = ""
    @State private var selectedItemID: Int?

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
                List(viewModel.savedListings.filter { item in
                    searchText.isEmpty
                        || item.listing.title.localizedStandardContains(searchText)
                        || (item.listing.districtName ?? "").localizedStandardContains(searchText)
                        || (item.notes ?? "").localizedStandardContains(searchText)
                }, selection: $selectedItemID) { item in
                    WatchlistRow(item: item) {
                        Task { await viewModel.unsave(listingId: item.listingId, using: appState.apiClient, undoManager: undoManager) }
                    }
                    .tag(item.listingId)
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
                .onDeleteCommand {
                    if let id = selectedItemID {
                        Task { await viewModel.unsave(listingId: id, using: appState.apiClient, undoManager: undoManager) }
                        selectedItemID = nil
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .searchable(text: $searchText, placement: .toolbar, prompt: "Search watchlist...")
        .navigationTitle("Watchlist")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .toolbar(id: "watchlist") {
            ToolbarItem(id: "export", placement: .automatic) {
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
            }
            ToolbarItem(id: "refresh", placement: .automatic) {
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
