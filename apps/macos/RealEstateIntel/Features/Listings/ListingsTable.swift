import SwiftUI

/// Table displaying listings with sortable columns and infinite scroll via sentinel row.
struct ListingsTable: View {
    @Bindable var viewModel: ListingsViewModel
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: 0) {
            Table(
                viewModel.filteredListings,
                selection: $viewModel.selectedListingID,
                sortOrder: $viewModel.sortOrder
            ) {
                TableColumn("Score") { listing in
                    ScoreIndicator(score: listing.currentScore ?? 0, size: .compact)
                }
                .width(min: 50, ideal: 56, max: 64)

                TableColumn("Title", value: \.title) { listing in
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: Theme.Spacing.xs) {
                            Text(listing.title)
                                .lineLimit(1)
                            if listing.hasAlertMatch {
                                Circle()
                                    .fill(Color.accentColor)
                                    .frame(width: 6, height: 6)
                                    .help("Matched a filter")
                            }
                        }
                        Text(listing.sourceCode)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .onAppear {
                        // Sentinel: trigger loadMore when last item appears
                        if listing.id == viewModel.filteredListings.last?.id, viewModel.hasMore {
                            Task { await viewModel.loadMore(using: appState.apiClient) }
                        }
                    }
                }
                .width(min: 200, ideal: 300)

                TableColumn("District") { listing in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(listing.districtName ?? "\u{2014}")
                        Text(listing.postalCode ?? "")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
                .width(min: 100, ideal: 130)

                TableColumn("Price", value: \.listPriceEur) { listing in
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(PriceFormatter.format(eur: listing.listPriceEur))
                            .monospacedDigit()
                        Text(PriceFormatter.formatPerSqm(listing.pricePerSqmEur ?? 0) + "/m\u{00B2}")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .monospacedDigit()
                    }
                }
                .width(min: 100, ideal: 140)

                TableColumn("Size") { listing in
                    Text(PriceFormatter.formatArea(listing.livingAreaSqm ?? 0))
                        .monospacedDigit()
                }
                .width(min: 70, ideal: 80)

                TableColumn("Rooms") { listing in
                    Text("\(listing.rooms ?? 0)")
                        .monospacedDigit()
                }
                .width(min: 50, ideal: 60)

                TableColumn("First Seen") { listing in
                    Text(PriceFormatter.relativeDate(listing.firstSeenAt))
                        .foregroundStyle(.secondary)
                }
                .width(min: 70, ideal: 80)
            }

            // Loading indicator at the bottom during pagination
            if viewModel.isLoadingMore {
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
    }
}
