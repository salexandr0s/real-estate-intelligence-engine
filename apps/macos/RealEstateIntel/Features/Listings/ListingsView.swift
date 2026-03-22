import SwiftUI

/// Main listings view with native Table, sortable columns, filters, and HSplitView inspector.
struct ListingsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = ListingsViewModel()
    @State private var showInspector: Bool = false
    @State private var exportError: String?

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                ListingsFilterBar(viewModel: viewModel)
                Divider()
                if let error = viewModel.errorMessage {
                    HStack(spacing: Theme.Spacing.sm) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.yellow)
                            .accessibilityHidden(true)
                        Text(error)
                            .font(.callout)
                        Spacer()
                        Button("Retry") {
                            Task { await viewModel.refresh(using: appState.apiClient, cache: appState.localCache) }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    .padding(.horizontal, Theme.Spacing.lg)
                    .padding(.vertical, Theme.Spacing.sm)
                    .background(Color.red.opacity(0.1))
                    Divider()
                }
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
                .background(.regularMaterial)
            }
        }
        .navigationTitle("Listings")
        .toolbar {
            ToolbarItem(placement: .principal) {
                ToolbarSearchField(text: $viewModel.searchText, prompt: "Search by title, district, postal code...")
                    .frame(minWidth: 200, idealWidth: 320, maxWidth: 400)
            }
            ToolbarItem(placement: .automatic) {
                Picker("View", selection: $viewModel.isMapMode) {
                    Label("List", systemImage: "list.bullet").tag(false)
                    Label("Map", systemImage: "map").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 80)
                .help("Toggle between list and map view")
            }
            ToolbarItem(placement: .automatic) {
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
            ToolbarItem(placement: .automatic) {
                Button {
                    Task { await viewModel.refresh(using: appState.apiClient, cache: appState.localCache) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(viewModel.isLoading)
                .help("Refresh listings")
            }
            ToolbarItem(placement: .automatic) {
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
        }
        .onChange(of: viewModel.selectedListingID) { _, newValue in
            if newValue != nil {
                showInspector = true
            }
        }
        .onChange(of: appState.deepLinkListingId) { _, newValue in
            if let listingId = newValue {
                viewModel.selectedListingID = listingId
                showInspector = true
                appState.deepLinkListingId = nil
            }
        }
        .alert("Export Failed", isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {} message: {
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
}

// MARK: - Native macOS Search Field

/// Wraps NSSearchField for a proper native macOS look in the toolbar.
private struct ToolbarSearchField: NSViewRepresentable {
    @Binding var text: String
    let prompt: String

    func makeNSView(context: Context) -> NSSearchField {
        let field = NSSearchField()
        field.placeholderString = prompt
        field.delegate = context.coordinator
        field.sendsSearchStringImmediately = true
        field.sendsWholeSearchString = false
        return field
    }

    func updateNSView(_ nsView: NSSearchField, context: Context) {
        if nsView.stringValue != text {
            nsView.stringValue = text
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    final class Coordinator: NSObject, NSSearchFieldDelegate {
        @Binding var text: String

        init(text: Binding<String>) {
            _text = text
        }

        func controlTextDidChange(_ obj: Notification) {
            guard let field = obj.object as? NSSearchField else { return }
            text = field.stringValue
        }
    }
}

#Preview {
    ListingsView()
        .environment(AppState())
        .frame(width: 1100, height: 600)
}
