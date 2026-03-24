import SwiftUI

/// A single row in the watchlist showing listing info, notes, and unsave action.
struct WatchlistRow: View {
    let item: SavedListingItem
    let onUnsave: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Score indicator
            if let score = item.listing.currentScore {
                ScoreIndicator(score: score)
            }

            // Listing info
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Text(item.listing.title)
                    .font(.body)
                    .lineLimit(1)

                HStack(spacing: Theme.Spacing.sm) {
                    if let district = item.listing.districtName {
                        Text(district)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let price = item.listing.listPriceEur {
                        Text(PriceFormatter.format(eur: Int(price)))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }

                    if let area = item.listing.livingAreaSqm {
                        Text("\(Int(area)) m²")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Text(item.listing.sourceCode)
                        .font(.caption2)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.1))
                        .clipShape(Capsule())
                }

                if let notes = item.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .italic()
                        .lineLimit(1)
                }
            }

            Spacer()

            // Saved date
            VStack(alignment: .trailing, spacing: 2) {
                Text("Saved")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Text(item.parsedSavedAt, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            // Unsave button
            Button("Remove from watchlist", systemImage: "bookmark.slash", action: onUnsave)
                .labelStyle(.iconOnly)
                .foregroundStyle(.red)
                .buttonStyle(.borderless)
                .help("Remove from watchlist")
        }
        .padding(.vertical, Theme.Spacing.xs)
    }
}
