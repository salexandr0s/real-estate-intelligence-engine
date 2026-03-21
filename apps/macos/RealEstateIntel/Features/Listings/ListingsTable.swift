import SwiftUI

/// Table displaying listings with sortable columns.
struct ListingsTable: View {
    @Bindable var viewModel: ListingsViewModel

    var body: some View {
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
                    Text(listing.title)
                        .lineLimit(1)
                    Text(listing.sourceCode)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
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
    }
}
