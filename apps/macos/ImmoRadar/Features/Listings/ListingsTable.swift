import AppKit
import SwiftUI

/// Table displaying listings with sortable columns and infinite scroll via sentinel row.
struct ListingsTable: View {
    @Bindable var viewModel: ListingsViewModel
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: 0) {
            listingTable
            if viewModel.isLoadingMore {
                loadingIndicator
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var listingTable: some View {
        let filtered = viewModel.filteredListings
        let lastID = filtered.last?.id
        return Table(
            filtered,
            selection: $viewModel.selectedListingID,
            sortOrder: $viewModel.sortOrder
        ) {
            TableColumn("Score") { (listing: Listing) in
                ScoreIndicator(score: listing.currentScore ?? 0, size: .compact)
            }
            .width(min: 50, ideal: 56, max: 64)

            TableColumn("Title", value: \.title) { (listing: Listing) in
                titleCell(listing, isLast: listing.id == lastID)
            }
            .width(min: 160, ideal: 300)

            TableColumn("District") { (listing: Listing) in
                districtCell(listing)
            }
            .width(min: 80, ideal: 130)

            TableColumn("Size") { (listing: Listing) in
                Text(PriceFormatter.formatArea(listing.livingAreaSqm))
                    .monospacedDigit()
            }
            .width(min: 70, ideal: 80)

            TableColumn("Price", value: \.sortableListPriceEur) { (listing: Listing) in
                HStack(spacing: 4) {
                    Text(PriceFormatter.format(eur: listing.listPriceEur))
                        .monospacedDigit()
                    if let pct = listing.lastPriceChangePct, pct != 0 {
                        PriceTrendBadge(changePct: pct)
                    }
                }
            }
            .width(min: 90, ideal: 150)

            TableColumn("Price/m\u{00B2}") { (listing: Listing) in
                Text(PriceFormatter.formatPerSqm(listing.pricePerSqmEur))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            .width(min: 70, ideal: 100)

            TableColumn("Rooms") { (listing: Listing) in
                Text(PriceFormatter.formatRooms(listing.rooms))
                    .monospacedDigit()
            }
            .width(min: 50, ideal: 60)

            TableColumn("First Seen") { (listing: Listing) in
                Text(PriceFormatter.relativeDate(listing.firstSeenAt))
                    .foregroundStyle(.secondary)
            }
            .width(min: 70, ideal: 80)
        }
        .contextMenu(forSelectionType: Int.self) { ids in
            if let id = ids.first,
               let listing = viewModel.filteredListings.first(where: { $0.id == id }) {
                if let browserURL = URL(string: listing.canonicalUrl) {
                    Button {
                        NSWorkspace.shared.open(browserURL)
                    } label: {
                        Label("Open in Browser", systemImage: "safari")
                    }
                }
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(listing.canonicalUrl, forType: .string)
                } label: {
                    Label("Copy URL", systemImage: "doc.on.doc")
                }
                if let url = URL(string: listing.canonicalUrl) {
                    ShareLink(item: url) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                }
                Divider()
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(listing.title, forType: .string)
                } label: {
                    Label("Copy Title", systemImage: "doc.on.clipboard")
                }
            }
        }
    }

    // MARK: - Cell Views

    @ViewBuilder
    private func titleCell(_ listing: Listing, isLast: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: Theme.Spacing.xs) {
                Text(listing.title)
                    .lineLimit(1)
                if listing.hasAlertMatch {
                    Image(systemName: "bell.badge.fill")
                        .font(.caption2)
                        .foregroundStyle(Color.accentColor)
                        .help("Matched a filter alert")
                }
            }
            HStack(spacing: Theme.Spacing.xs) {
                SourceLogo(sourceCode: listing.sourceCode, size: 14)
                Text(listing.sourceCode)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .onAppear {
            if isLast, viewModel.hasMore {
                Task { await viewModel.loadMore(using: appState.apiClient) }
            }
        }
    }

    @ViewBuilder
    private func districtCell(_ listing: Listing) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(listing.districtName ?? "\u{2014}")
            Text(listing.postalCode ?? "")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    // MARK: - Loading

    private var loadingIndicator: some View {
        HStack(spacing: Theme.Spacing.sm) {
            ProgressView()
                .controlSize(.small)
            Text("Loading more listings...")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}
