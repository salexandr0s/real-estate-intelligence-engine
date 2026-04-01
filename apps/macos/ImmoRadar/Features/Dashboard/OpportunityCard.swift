import AppKit
import SwiftUI

/// Ranked opportunity row used in the investor queue section.
struct OpportunityCard: View {
    let listing: Listing
    let rank: Int
    var onTap: (() -> Void)?
    var isHovered: Bool = false

    private var isNew: Bool {
        listing.wasSeenWithinLast24Hours
    }

    var body: some View {
        Button(action: { onTap?() }) {
            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                Text(rank.formatted(.number.precision(.integerLength(2...))))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.tertiary)
                    .frame(width: 28, alignment: .leading)

                ScoreIndicator(score: listing.currentScore ?? 0, size: .compact)

                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(listing.title)
                        .font(.subheadline)
                        .adaptiveFontWeight(.medium)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    HStack(spacing: Theme.Spacing.xs) {
                        if let district = listing.districtName {
                            Text(district)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }

                        if let rooms = listing.rooms {
                            Text(PriceFormatter.formatRooms(rooms))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.tertiary)
                        }

                        if let area = listing.livingAreaSqm {
                            Text(PriceFormatter.formatArea(area))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.tertiary)
                        }

                        Text(PriceFormatter.relativeDate(listing.firstSeenAt))
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }

                Spacer(minLength: Theme.Spacing.md)

                VStack(alignment: .trailing, spacing: Theme.Spacing.xs) {
                    Text(PriceFormatter.formatCompact(listing.listPriceEur))
                        .font(.subheadline.monospacedDigit())
                        .adaptiveFontWeight(.semibold)
                        .foregroundStyle(.primary)

                    HStack(spacing: Theme.Spacing.xs) {
                        if isNew {
                            DashboardCapsuleLabel(
                                text: "NEW",
                                tint: Theme.Dashboard.iconTint(for: .accent),
                                foreground: .white,
                                filled: true
                            )
                        }

                        if let pct = listing.lastPriceChangePct, pct < 0 {
                            DashboardCapsuleLabel(
                                text: PriceFormatter.formatPercent(pct),
                                tint: Theme.Dashboard.iconTint(for: .positive),
                                foreground: Theme.Dashboard.iconTint(for: .positive),
                                filled: false
                            )
                        }
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

private struct DashboardCapsuleLabel: View {
    let text: String
    let tint: Color
    let foreground: Color
    let filled: Bool

    var body: some View {
        Text(text)
            .font(.caption2.monospacedDigit())
            .adaptiveFontWeight(.semibold)
            .foregroundStyle(foreground)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(tint.opacity(filled ? 1 : 0.12), in: Capsule())
    }
}
