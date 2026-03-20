import SwiftUI

/// Main listings view with native Table, sortable columns, filters, and detail inspector.
struct ListingsView: View {
    @State private var viewModel = ListingsViewModel()
    @State private var showInspector: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            filterBar
            Divider()
            listingsTable
        }
        .navigationTitle("Listings")
        .searchable(text: $viewModel.searchText, prompt: "Search by title, district, postal code...")
        .inspector(isPresented: $showInspector) {
            inspectorContent
                .inspectorColumnWidth(min: 320, ideal: 380, max: 500)
        }
        .toolbar {
            ToolbarItemGroup {
                toolbarItems
            }
        }
        .task {
            await viewModel.refresh()
        }
        .onChange(of: viewModel.selectedListingID) { _, newValue in
            if newValue != nil {
                showInspector = true
            }
        }
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Operation type
            Picker("Type", selection: $viewModel.selectedOperationType) {
                Text("All Types").tag(nil as OperationType?)
                ForEach(OperationType.allCases, id: \.self) { type in
                    Text(type.rawValue.capitalized).tag(type as OperationType?)
                }
            }
            .frame(width: 120)

            // Property type
            Picker("Property", selection: $viewModel.selectedPropertyType) {
                Text("All Properties").tag(nil as PropertyType?)
                ForEach(PropertyType.allCases) { type in
                    Text(type.displayName).tag(type as PropertyType?)
                }
            }
            .frame(width: 140)

            // District
            Picker("District", selection: $viewModel.selectedDistrict) {
                Text("All Districts").tag(nil as Int?)
                ForEach(viewModel.availableDistricts, id: \.number) { district in
                    Text("\(district.number). \(district.name)").tag(district.number as Int?)
                }
            }
            .frame(width: 180)

            Divider()
                .frame(height: 20)

            // Price range
            HStack(spacing: Theme.Spacing.xs) {
                Text("Price:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("Min", text: $viewModel.minPrice)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 80)
                Text("--")
                    .foregroundStyle(.quaternary)
                TextField("Max", text: $viewModel.maxPrice)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 80)
            }

            // Min score
            HStack(spacing: Theme.Spacing.xs) {
                Text("Score:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("Min", text: $viewModel.minScore)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 60)
            }

            Spacer()

            if viewModel.hasActiveFilters {
                Button("Clear Filters") {
                    viewModel.clearFilters()
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
            }

            Text("\(viewModel.filteredListings.count) listings")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    // MARK: - Table

    private var listingsTable: some View {
        Table(
            viewModel.filteredListings,
            selection: $viewModel.selectedListingID,
            sortOrder: $viewModel.sortOrder
        ) {
            TableColumn("Score", value: \.currentScore) { listing in
                ScoreIndicator(score: listing.currentScore, size: .compact)
            }
            .width(min: 50, ideal: 56, max: 64)

            TableColumn("Title", value: \.title) { listing in
                VStack(alignment: .leading, spacing: 1) {
                    Text(listing.title)
                        .lineLimit(1)
                    Text(listing.sourceCode)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .width(min: 200, ideal: 300)

            TableColumn("District", value: \.districtName) { listing in
                VStack(alignment: .leading, spacing: 1) {
                    Text(listing.districtName)
                    Text(listing.postalCode)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .width(min: 100, ideal: 130)

            TableColumn("Price", value: \.listPriceEur) { listing in
                VStack(alignment: .trailing, spacing: 1) {
                    Text(PriceFormatter.format(eur: listing.listPriceEur))
                        .monospacedDigit()
                    Text(PriceFormatter.formatPerSqm(listing.pricePerSqmEur) + "/m\u{00B2}")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .monospacedDigit()
                }
            }
            .width(min: 100, ideal: 140)

            TableColumn("Size", value: \.livingAreaSqm) { listing in
                Text(PriceFormatter.formatArea(listing.livingAreaSqm))
                    .monospacedDigit()
            }
            .width(min: 70, ideal: 80)

            TableColumn("Rooms", value: \.rooms) { listing in
                Text("\(listing.rooms)")
                    .monospacedDigit()
            }
            .width(min: 50, ideal: 60)

            TableColumn("First Seen") { listing in
                Text(PriceFormatter.relativeDate(listing.firstSeenAt))
                    .foregroundStyle(.secondary)
            }
            .width(min: 70, ideal: 80)
        }
    }

    // MARK: - Inspector

    @ViewBuilder
    private var inspectorContent: some View {
        if let listing = viewModel.selectedListing {
            ListingDetailView(listing: listing)
        } else {
            ContentUnavailableView {
                Label("Select a listing", systemImage: "building.2")
            } description: {
                Text("Click a row to view details")
            }
        }
    }

    // MARK: - Toolbar

    @ViewBuilder
    private var toolbarItems: some View {
        Button {
            showInspector.toggle()
        } label: {
            Label("Inspector", systemImage: "sidebar.trailing")
        }
        .help("Toggle listing detail inspector")

        Button {
            Task { await viewModel.refresh() }
        } label: {
            Label("Refresh", systemImage: "arrow.clockwise")
        }
        .disabled(viewModel.isLoading)
        .help("Refresh listings")
    }
}

#Preview {
    ListingsView()
        .environment(AppState())
        .frame(width: 1100, height: 600)
}
