import AppKit
import SwiftUI

/// Compact property row for filter-matched listings on the dashboard.
struct ForYouListingCard: View {
    let listing: Listing
    var onTap: (() -> Void)?
    var isHovered: Bool = false

    private var isNew: Bool {
        Calendar.current.dateComponents([.hour], from: listing.firstSeenAt, to: .now).hour ?? 99 < 24
    }

    var body: some View {
        Button(action: { onTap?() }) {
            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                ScoreIndicator(score: listing.currentScore ?? 0, size: .compact)

                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                        Text(listing.title)
                            .font(.caption)
                            .adaptiveFontWeight(.medium)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text(PriceFormatter.formatCompact(listing.listPriceEur))
                            .font(.caption.monospacedDigit())
                            .adaptiveFontWeight(.medium)
                            .foregroundStyle(.primary)
                    }

                    HStack(spacing: Theme.Spacing.xs) {
                        if isNew {
                            Text("NEW")
                                .font(.caption2)
                                .adaptiveFontWeight(.bold)
                                .foregroundStyle(.white)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Theme.Dashboard.iconTint(for: .accent), in: Capsule())
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

                        if let pct = listing.lastPriceChangePct, pct < 0 {
                            Text(PriceFormatter.formatPercent(pct))
                                .font(.caption2.monospacedDigit())
                                .adaptiveFontWeight(.semibold)
                                .foregroundStyle(Color.scoreGood)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(Color.scoreGood.opacity(0.12), in: Capsule())
                        }

                        Text(PriceFormatter.relativeDate(listing.firstSeenAt))
                            .font(.caption2)
                            .foregroundStyle(.quaternary)
                    }
                }
            }
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.sm)
            .background(
                isHovered ? Color(nsColor: .separatorColor).opacity(0.08) : .clear,
                in: .rect(cornerRadius: Theme.Radius.md)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
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
        }
    }
}

#Preview {
    VStack(spacing: 0) {
        ForYouListingCard(listing: Listing.samples[0])
        Divider().padding(.leading, 40)
        ForYouListingCard(listing: Listing.samples[1])
    }
    .padding()
    .frame(width: 520)
}
