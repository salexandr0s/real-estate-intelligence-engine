import AppKit
import SwiftUI

/// Two-row opportunity card with property metadata.
struct OpportunityCard: View {
    let listing: Listing
    var districtAvgPpsqm: Double?
    var onTap: (() -> Void)?
    var onAddToWatchlist: (() -> Void)?
    var isHovered: Bool = false

    private var discount: Double? {
        guard let avg = districtAvgPpsqm, avg > 0,
              let ppsqm = listing.pricePerSqmEur else { return nil }
        return (ppsqm - avg) / avg
    }

    private var isNew: Bool {
        Calendar.current.dateComponents([.hour], from: listing.firstSeenAt, to: .now).hour ?? 99 < 24
    }

    var body: some View {
        Button(action: { onTap?() }) {
            VStack(alignment: .leading, spacing: 2) {
                // Row 1: Score + Title + Price
                HStack(spacing: Theme.Spacing.sm) {
                    ScoreIndicator(score: listing.currentScore ?? 0, size: .compact)

                    Text(listing.title)
                        .font(.caption.weight(.medium))
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(PriceFormatter.formatCompact(listing.listPriceEur))
                        .font(.caption.monospacedDigit().weight(.medium))
                }

                // Row 2: Metadata + Discount
                HStack(spacing: Theme.Spacing.xs) {
                    // Leading spacer to align under title (past score indicator)
                    Color.clear.frame(width: 32)

                    if isNew {
                        Text("NEW")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Color.accentColor)
                            .clipShape(Capsule())
                    }

                    if let district = listing.districtName {
                        Text(district)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }

                    if let rooms = listing.rooms {
                        Text(PriceFormatter.formatRooms(rooms))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.tertiary)
                    }

                    if let area = listing.livingAreaSqm {
                        Text(PriceFormatter.formatArea(area))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.tertiary)
                    }

                    Spacer(minLength: 0)

                    if let discount, discount < 0 {
                        Text(PriceFormatter.formatPercent(discount))
                            .font(.caption2.weight(.semibold).monospacedDigit())
                            .foregroundStyle(Color.scoreExcellent)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Color.scoreExcellent.opacity(0.12))
                            .clipShape(Capsule())
                    }
                }
            }
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.xs)
            .background(
                isHovered ? Color(nsColor: .separatorColor).opacity(0.08) : .clear,
                in: .rect(cornerRadius: Theme.Radius.sm)
            )
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                onTap?()
            } label: {
                Label("Open Listing", systemImage: "arrow.right.circle")
            }

            if let url = URL(string: listing.canonicalUrl) {
                Button {
                    NSWorkspace.shared.open(url)
                } label: {
                    Label("Open in Browser", systemImage: "safari")
                }
            }

            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(listing.canonicalUrl, forType: .string)
            } label: {
                Label("Copy Link", systemImage: "doc.on.doc")
            }

            Divider()

            if let onAddToWatchlist {
                Button {
                    onAddToWatchlist()
                } label: {
                    Label("Add to Watchlist", systemImage: "bookmark")
                }
            }
        }
    }
}
