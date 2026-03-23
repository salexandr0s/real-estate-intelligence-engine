import SwiftUI

/// Renders a list of tappable listing cards in the copilot chat.
struct ListingCardBlock: View {
    let listings: [CopilotListing]
    let onTap: (Int) -> Void

    var body: some View {
        VStack(spacing: Theme.Spacing.sm) {
            ForEach(listings) { listing in
                Button {
                    onTap(listing.id)
                } label: {
                    CopilotListingCard(listing: listing)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Single Listing Card

/// Compact listing card for copilot responses — mirrors ListingRow style.
private struct CopilotListingCard: View {
    let listing: CopilotListing

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Score
            if let score = listing.score {
                ScoreIndicator(score: score, size: .compact)
            }

            // Details
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(listing.title)
                    .font(.body)
                    .lineLimit(1)

                HStack(spacing: Theme.Spacing.sm) {
                    if let district = listing.districtName ?? listing.districtNo.map({ "\($0). Bezirk" }) {
                        Label(district, systemImage: "mappin")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Text(PriceFormatter.format(eur: listing.priceEur))
                        .font(.caption.monospacedDigit().bold())

                    if let pct = listing.priceTrendPct, pct != 0 {
                        PriceTrendBadge(changePct: pct)
                    }

                    if let area = listing.areaSqm {
                        Text(PriceFormatter.formatArea(area))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }

                    if let rooms = listing.rooms {
                        Text("\(PriceFormatter.formatRooms(rooms))R")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
        .shadow(radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
        .contentShape(Rectangle())
    }
}
