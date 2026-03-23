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

                    if let pct = listing.lastPriceChangePct, pct != 0 {
                        PriceTrendBadge(changePct: pct)
                    }

                    Text(PriceFormatter.formatArea(listing.livingAreaSqm ?? 0))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)

                    Text("\(PriceFormatter.formatRooms(listing.rooms))R")
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

/// Small badge showing price change direction and percentage.
struct PriceTrendBadge: View {
    let changePct: Double

    private var isDecrease: Bool { changePct < 0 }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: isDecrease ? "arrow.down.right" : "arrow.up.right")
                .font(.system(size: 7, weight: .bold))
            let pct = Text(abs(changePct), format: .number.precision(.fractionLength(1)))
            let suffix = Text("%")
            Text("\(pct)\(suffix)")
                .font(.system(size: 9, weight: .semibold).monospacedDigit())
        }
        .foregroundStyle(isDecrease ? .green : .red)
        .padding(.horizontal, 4)
        .padding(.vertical, 1)
        .background(
            (isDecrease ? Color.green : Color.red).opacity(0.1),
            in: RoundedRectangle(cornerRadius: 3)
        )
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
