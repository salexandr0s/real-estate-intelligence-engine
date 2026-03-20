import SwiftUI

/// Compact listing row used on the dashboard for recent high-score listings.
struct DashboardListingRow: View {
    let listing: Listing

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            ScoreIndicator(score: listing.currentScore, size: .compact)

            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(listing.title)
                    .font(.body)
                    .lineLimit(1)
                HStack(spacing: Theme.Spacing.sm) {
                    Text(listing.districtName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("--")
                        .font(.caption)
                        .foregroundStyle(.quaternary)
                    Text(PriceFormatter.format(eur: listing.listPriceEur))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    Text("--")
                        .font(.caption)
                        .foregroundStyle(.quaternary)
                    Text(PriceFormatter.formatArea(listing.livingAreaSqm))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Text(PriceFormatter.relativeDate(listing.firstSeenAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, Theme.Spacing.sm)
        .contentShape(Rectangle())
    }
}
