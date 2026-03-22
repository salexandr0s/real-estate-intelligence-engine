import SwiftUI

/// Header section for the listing detail inspector showing status, title, price, and key metrics.
struct ListingHeaderSection: View {
    let listing: Listing
    var isSaved: Bool = false
    var onToggleSave: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                StatusBadge(listingStatus: listing.listingStatus)

                Spacer()

                if let onToggleSave {
                    Button {
                        onToggleSave()
                    } label: {
                        Image(systemName: isSaved ? "bookmark.fill" : "bookmark")
                            .foregroundStyle(isSaved ? .yellow : .secondary)
                    }
                    .buttonStyle(.borderless)
                    .help(isSaved ? "Remove from watchlist" : "Save to watchlist")
                }

                HStack(spacing: Theme.Spacing.xs) {
                    SourceLogo(sourceCode: listing.sourceCode, size: 14)
                    Text(listing.sourceCode)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color.secondary.opacity(0.1), in: Capsule())
            }

            Text(listing.title)
                .font(.title3.bold())
                .fixedSize(horizontal: false, vertical: true)

            Text(PriceFormatter.format(eur: listing.listPriceEur))
                .font(.title2.bold().monospacedDigit())
                .foregroundStyle(.blue)

            HStack(spacing: Theme.Spacing.lg) {
                Label(PriceFormatter.formatArea(listing.livingAreaSqm ?? 0), systemImage: "ruler")
                    .font(.subheadline)
                Label("\(PriceFormatter.formatRooms(listing.rooms)) rooms", systemImage: "square.split.2x2")
                    .font(.subheadline)
                Label(
                    PriceFormatter.formatPerSqm(listing.pricePerSqmEur ?? 0) + "/m\u{00B2}",
                    systemImage: "eurosign"
                )
                .font(.subheadline.monospacedDigit())
            }
            .foregroundStyle(.secondary)
        }
    }
}
