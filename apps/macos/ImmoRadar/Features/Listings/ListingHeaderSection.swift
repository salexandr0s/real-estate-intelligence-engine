import SwiftUI

/// Header section for the listing detail inspector showing status, title, price, score, and key metrics.
struct ListingHeaderSection: View {
    let listing: Listing
    var cluster: ListingCluster?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            // Row 1: Status + source
            HStack {
                StatusBadge(listingStatus: listing.listingStatus)

                Spacer()

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

            // Row 2: Title
            Text(listing.title)
                .font(.title3.bold())
                .fixedSize(horizontal: false, vertical: true)

            // Row 3: Price + score
            HStack(alignment: .center) {
                Text(PriceFormatter.format(eur: listing.listPriceEur))
                    .font(.title2.bold().monospacedDigit())
                    .foregroundStyle(.blue)

                Spacer()

                if let score = listing.currentScore {
                    VStack(alignment: .trailing, spacing: Theme.Spacing.xxs) {
                        ScoreIndicator(score: score, size: .regular)
                        Text(Theme.scoreLabel(for: score))
                            .font(.caption2.bold())
                            .foregroundStyle(Theme.scoreColor(for: score))
                    }
                }
            }

            // Row 4: Key metrics
            HStack(spacing: Theme.Spacing.lg) {
                Label(PriceFormatter.formatArea(listing.livingAreaSqm), systemImage: "ruler")
                    .font(.subheadline)
                Label(roomLabel, systemImage: "square.split.2x2")
                    .font(.subheadline)
                Label(pricePerSqmLabel, systemImage: "eurosign")
                    .font(.subheadline.monospacedDigit())
            }
            .foregroundStyle(.secondary)

            // Row 5: Cross-source badge (conditional)
            if let cluster {
                CrossSourceBadge(cluster: cluster, currentListingId: listing.id)
            }
        }
    }

    private var roomLabel: String {
        if let rooms = listing.rooms {
            return "\(PriceFormatter.formatRooms(rooms)) rooms"
        }
        return "—"
    }

    private var pricePerSqmLabel: String {
        if let pricePerSqm = listing.pricePerSqmEur {
            return PriceFormatter.formatPerSqm(pricePerSqm) + "/m\u{00B2}"
        }
        return "—"
    }
}
