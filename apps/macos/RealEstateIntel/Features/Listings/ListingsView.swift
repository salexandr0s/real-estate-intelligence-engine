import SwiftUI

/// Main listings view with native Table, sortable columns, filters, and detail inspector.
struct ListingsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = ListingsViewModel()
    @State private var showInspector: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            ListingsFilterBar(viewModel: viewModel)
            Divider()
            ListingsTable(viewModel: viewModel)
        }
        .navigationTitle("Listings")
        .searchable(text: $viewModel.searchText, prompt: "Search by title, district, postal code...")
        .inspector(isPresented: $showInspector) {
            ListingsInspectorContent(listing: viewModel.selectedListing)
                .inspectorColumnWidth(min: 320, ideal: 380, max: 500)
        }
        .toolbar {
            ToolbarItemGroup {
                ListingsToolbar(
                    showInspector: $showInspector,
                    isLoading: viewModel.isLoading
                ) {
                    Task { await viewModel.refresh(using: appState.apiClient, cache: appState.localCache) }
                }
            }
        }
        .task {
            await viewModel.refresh(using: appState.apiClient, cache: appState.localCache)
        }
        .onChange(of: viewModel.selectedListingID) { _, newValue in
            if newValue != nil {
                showInspector = true
            }
        }
    }
}

#Preview {
    ListingsView()
        .environment(AppState())
        .frame(width: 1100, height: 600)
}
