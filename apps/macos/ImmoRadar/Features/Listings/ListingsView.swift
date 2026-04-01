import SwiftUI

/// Main listings view with native Table, sortable columns, filters, and inspector panel.
struct ListingsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = ListingsViewModel()
    @State private var showInspector: Bool = false
    @State private var exportError: String?
    @State private var showExportError: Bool = false

    var body: some View {
        HSplitView {
            ListingsPrimaryPane(viewModel: viewModel, appState: appState)
            .frame(minWidth: 400, maxHeight: .infinity)

            if showInspector {
                ListingsInspectorContent(listing: viewModel.selectedListing) {
                    if let listing = viewModel.selectedListing, let coord = listing.coordinate {
                        viewModel.focusedMapCoordinate = coord
                        viewModel.mapFocusTrigger += 1
                        viewModel.isMapMode = true
                    }
                }
                .frame(minWidth: 280, idealWidth: 360, maxWidth: 480)
                .adaptiveMaterial(.regularMaterial)
            }
        }
        .searchable(text: $viewModel.searchText, placement: .toolbar, prompt: "Search listings...")
        .navigationTitle("Listings")
        .toolbar(id: "listings") {
            ToolbarItem(id: "viewMode", placement: .automatic) {
                Picker("View", selection: $viewModel.isMapMode) {
                    Label("List", systemImage: "list.bullet").tag(false)
                    Label("Map", systemImage: "map").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 80)
                .help("Toggle between list and map view")
            }
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
                .disabled(viewModel.filteredListings.isEmpty)
                .help("Export filtered listings as CSV")
            }
            ToolbarItem(id: "refresh", placement: .automatic) {
                Button {
                    Task { await viewModel.refresh(using: appState.apiClient, cache: appState.localCache) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(viewModel.isLoading)
                .help("Refresh listings")
            }
            ToolbarItem(id: "inspector", placement: .automatic) {
                Button {
                    showInspector.toggle()
                } label: {
                    Label("Inspector", systemImage: "sidebar.trailing")
                }
                .help("Toggle listing detail inspector")
            }
        }
        .task {
            await viewModel.refresh(using: appState.apiClient, cache: appState.localCache)
            consumePendingDeepLinkIfNeeded()
        }
        .onChange(of: viewModel.selectedListingID) { _, newValue in
            if newValue != nil {
                showInspector = true
            }
        }
        .onChange(of: appState.deepLinkListingId) { _, newValue in
            if newValue != nil {
                consumePendingDeepLinkIfNeeded()
            }
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

    private func exportToFile(_ data: Data) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.commaSeparatedText]
        panel.nameFieldStringValue = "listings.csv"
        panel.title = "Export Listings"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try data.write(to: url)
            } catch {
                exportError = error.localizedDescription
            }
        }
    }

    private func consumePendingDeepLinkIfNeeded() {
        guard let listingId = appState.deepLinkListingId else { return }
        viewModel.revealListing(id: listingId)
        showInspector = true
        appState.deepLinkListingId = nil
    }
}

private struct ListingsPrimaryPane: View {
    @Bindable var viewModel: ListingsViewModel
    let appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            ListingsFilterBar(viewModel: viewModel)
            Divider()

            if let error = viewModel.errorMessage {
                ListingsErrorBanner(error: error) {
                    Task { await viewModel.refresh(using: appState.apiClient, cache: appState.localCache) }
                }
                Divider()
            }

            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && viewModel.listings.isEmpty {
            ContentUnavailableView {
                Label("Loading Listings", systemImage: "building.2")
            } description: {
                Text("Fetching listings from the server\u{2026}")
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay {
                ProgressView()
                    .controlSize(.large)
                    .offset(y: -60)
            }
        } else if !viewModel.isLoading && viewModel.hasLoaded && viewModel.filteredListings.isEmpty {
            ContentUnavailableView {
                Label(
                    viewModel.hasActiveFilters ? "No Matching Listings" : "No Listings",
                    systemImage: viewModel.hasActiveFilters ? "line.3.horizontal.decrease.circle" : "building.2"
                )
            } description: {
                Text(
                    viewModel.hasActiveFilters
                        ? "No listings match your current filters."
                        : "No listings available yet."
                )
            } actions: {
                if viewModel.hasActiveFilters {
                    Button("Clear Filters") {
                        viewModel.clearFilters()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.isMapMode {
            ListingsMapView(viewModel: viewModel)
        } else {
            ListingsTable(viewModel: viewModel)
        }
    }
}

private struct ListingsErrorBanner: View {
    let error: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.yellow)
                .accessibilityHidden(true)
            Text(error)
                .font(.callout)
            Spacer()
            Button("Retry", action: onRetry)
                .buttonStyle(.bordered)
                .controlSize(.small)
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Color.red.opacity(0.1))
    }
}

#Preview {
    ListingsView()
        .environment(AppState())
        .frame(width: 1100, height: 600)
}
