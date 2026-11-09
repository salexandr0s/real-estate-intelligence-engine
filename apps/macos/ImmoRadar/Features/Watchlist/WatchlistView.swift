import SwiftUI

/// Watchlist view showing user-saved listings with notes and export.
struct WatchlistView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.undoManager) private var undoManager
    @State private var viewModel = WatchlistViewModel()
    @State private var searchText = ""
    @State private var selectedItemID: Int?
    @State private var exportError: String?
    @State private var showExportError: Bool = false

    private var filteredItems: [SavedListingItem] {
        viewModel.filteredSavedListings(matching: searchText)
    }

    var body: some View {
        VStack(spacing: 0) {
            // While the global banner explains a connection problem, a failed load keeps the
            // rows already shown without a banner of its own.
            if let error = viewModel.errorMessage,
               appState.globalConnectionWarningMessage == nil,
               !AppErrorPresentation.isConnectionIssue(message: error) {
                InlineWarningBanner(
                    title: "Couldn’t load the watchlist.",
                    message: error,
                    actions: [
                        .init("Retry", systemImage: "arrow.clockwise", isProminent: true) {
                            Task { await viewModel.refresh(using: appState.apiClient) }
                        },
                    ]
                )
            }

            if let actionError = viewModel.actionErrorMessage {
                InlineWarningBanner(
                    title: "Couldn’t update the watchlist.",
                    message: actionError,
                    actions: [
                        .init("Dismiss") { viewModel.actionErrorMessage = nil },
                    ]
                )
            }

            if viewModel.savedListings.isEmpty && !viewModel.isLoading {
                ContentUnavailableView {
                    Label("No Saved Listings", systemImage: "bookmark")
                } description: {
                    Text("Save listings from the detail view to track them here.")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !viewModel.savedListings.isEmpty && filteredItems.isEmpty && !searchText.isEmpty && !viewModel.hasMorePages {
                ContentUnavailableView.search
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: $selectedItemID) {
                    ForEach(filteredItems) { item in
                        WatchlistRow(
                            item: item,
                            isSavingNotes: viewModel.savingNotesListingId == item.listingId,
                            onSaveNotes: { notes in
                                Task { await viewModel.saveNotes(for: item.listingId, notes: notes, using: appState.apiClient) }
                            },
                            onUnsave: {
                                Task { await viewModel.unsave(listingId: item.listingId, using: appState.apiClient, undoManager: undoManager) }
                            }
                        )
                        .tag(item.listingId)
                    }

                    if viewModel.hasMorePages {
                        nextPageRow
                    }
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
                        do {
                            let data = try await viewModel.exportCSV(using: appState.apiClient)
                            exportToFile(data)
                        } catch {
                            exportError = AppErrorPresentation.message(for: error)
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
            guard appState.allowsAutomaticFeatureLoads else { return }
            await viewModel.refresh(using: appState.apiClient)
        }
        .onChange(of: appState.navigationState.refreshGeneration) {
            Task { await viewModel.refresh(using: appState.apiClient) }
        }
        .onChange(of: exportError) { _, newValue in
            showExportError = newValue != nil
        }
        .alert("Export Failed", isPresented: $showExportError) {
            Button("OK", role: .cancel) { exportError = nil }
        } message: {
            if let msg = exportError { Text(msg) }
        }
    }

    /// The last row while the server has more saved listings. Reaching it loads the next page.
    private var nextPageRow: some View {
        HStack {
            Spacer()
            if viewModel.nextPageFailed && !viewModel.isLoadingNextPage {
                Button("Load More") {
                    Task { await viewModel.loadNextPage(using: appState.apiClient) }
                }
                .controlSize(.small)
            } else {
                ProgressView()
                    .controlSize(.small)
            }
            Spacer()
        }
        .padding(.vertical, Theme.Spacing.xs)
        .task(id: viewModel.nextCursor) {
            guard !viewModel.nextPageFailed else { return }
            await viewModel.loadNextPage(using: appState.apiClient)
        }
    }

    private func exportToFile(_ data: Data) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "watchlist.csv"
        panel.allowedContentTypes = [.commaSeparatedText]
        panel.begin { result in
            if result == .OK, let url = panel.url {
                do {
                    try data.write(to: url)
                } catch {
                    exportError = error.localizedDescription
                }
            }
        }
    }
}

#Preview {
    WatchlistView()
        .environment(AppState())
        .frame(width: 800, height: 600)
}
