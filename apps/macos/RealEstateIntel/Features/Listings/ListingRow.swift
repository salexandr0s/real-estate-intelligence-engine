import SwiftUI

/// Compact listing row for use in non-table contexts (dashboard, alerts).
struct ListingRow: View {
    let listing: Listing

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            ScoreIndicator(score: listing.currentScore ?? 0, size: .compact)

            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(listing.title)
                    .font(.body)
                    .lineLimit(1)

                HStack(spacing: Theme.Spacing.sm) {
                    Label(listing.districtName ?? listing.city, systemImage: "mappin")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Spacer()

                    Text(PriceFormatter.format(eur: listing.listPriceEur))
                        .font(.caption.monospacedDigit().bold())

                    Text(PriceFormatter.formatArea(listing.livingAreaSqm ?? 0))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)

                    Text("\(listing.rooms ?? 0)R")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            Text(PriceFormatter.relativeDate(listing.firstSeenAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
                .frame(width: 50, alignment: .trailing)
        }
        .padding(.vertical, Theme.Spacing.xs)
        .contentShape(Rectangle())
    }
}

#Preview {
    VStack(spacing: 0) {
        ForEach(Listing.samples.prefix(3)) { listing in
            ListingRow(listing: listing)
            Divider()
        }
    }
    .padding()
    .frame(width: 600)
}
