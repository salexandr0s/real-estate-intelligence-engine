import SwiftUI

struct AlertTypePresentation {
    let title: String
    let icon: String
    let tint: Color
}

struct AlertStatusPresentation {
    let title: String
    let icon: String
    let tint: Color
    let background: Color
}

struct AlertPresentation {
    let type: AlertTypePresentation
    let status: AlertStatusPresentation
    let reasonSummary: String

    static func make(for alert: Alert) -> AlertPresentation {
        let type = AlertTypePresentation(
            title: alert.alertType.displayName,
            icon: alert.alertType.iconName,
            tint: Theme.alertColor(for: alert.alertType)
        )

        let status: AlertStatusPresentation = switch alert.status {
        case .unread:
            .init(title: "Unread", icon: "circle.fill", tint: .accentColor, background: Color.accentColor.opacity(0.12))
        case .opened:
            .init(title: "Reviewed", icon: "eye.fill", tint: .secondary, background: Color.secondary.opacity(0.10))
        case .dismissed:
            .init(title: "Dismissed", icon: "archivebox.fill", tint: .secondary, background: Color.secondary.opacity(0.10))
        }

        return .init(
            type: type,
            status: status,
            reasonSummary: reasonSummary(for: alert)
        )
    }

    private static func reasonSummary(for alert: Alert) -> String {
        switch alert.alertType {
        case .priceDrop:
            if let change = alert.listing?.lastPriceChangePct, change != 0 {
                return "Price moved \(change.formatted(.number.precision(.fractionLength(1))))% since the previous observation."
            }
        case .scoreUpgrade, .scoreDowngrade:
            if let score = alert.listing?.currentScore {
                return "Current score is \(score.formatted(.number.precision(.fractionLength(1)))) with updated investor fit."
            }
        case .statusChange:
            return "Listing status changed and needs review."
        case .newMatch:
            break
        }

        guard let reasons = alert.matchReasons else {
            return alert.body
        }

        var segments: [String] = []

        if reasons.districtMatch == true {
            segments.append("district match")
        }

        let keywords = reasons.matchedKeywords ?? []
        if !keywords.isEmpty {
            segments.append("keywords: \(keywords.prefix(2).joined(separator: ", "))")
        }

        let thresholds = thresholdLabels(for: reasons)
        if !thresholds.isEmpty {
            segments.append("thresholds: \(thresholds.joined(separator: ", "))")
        }

        if segments.isEmpty {
            return alert.body
        }

        return "Matched on \(segments.joined(separator: " • "))."
    }

    private static func thresholdLabels(for reasons: AlertMatchReasons) -> [String] {
        var labels: [String] = []
        if reasons.thresholdsMet?.price == true { labels.append("price") }
        if reasons.thresholdsMet?.area == true { labels.append("area") }
        if reasons.thresholdsMet?.rooms == true { labels.append("rooms") }
        if reasons.thresholdsMet?.score == true { labels.append("score") }
        return labels
    }
}

struct AlertRow: View {
    let alert: Alert
    var isSelected: Bool = false

    private var presentation: AlertPresentation {
        AlertPresentation.make(for: alert)
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            unreadIndicator

            leadingVisual

            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                headlineRow
                contextRow
                summaryRow
                metadataRow

                if isSelected, let reasons = alert.matchReasons {
                    AlertMatchReasonChips(reasons: reasons)
                        .padding(.top, Theme.Spacing.xxs)
                }
            }
        }
        .padding(.vertical, Theme.Spacing.sm)
        .opacity(alert.status == .dismissed ? 0.72 : 1.0)
    }

    private var unreadIndicator: some View {
        Circle()
            .fill(alert.status == .unread ? Color.accentColor : Color.clear)
            .frame(width: 8, height: 8)
            .padding(.top, 8)
    }

    @ViewBuilder
    private var leadingVisual: some View {
        if let score = alert.listing?.currentScore {
            ScoreIndicator(score: score, size: .compact)
                .frame(width: 34)
                .padding(.top, 2)
        } else {
            Image(systemName: presentation.type.icon)
                .font(.callout.weight(.semibold))
                .foregroundStyle(presentation.type.tint)
                .frame(width: 30, height: 30)
                .background(presentation.type.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .padding(.top, 2)
        }
    }

    private var headlineRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Text(alert.listing?.title ?? alert.title)
                .font(.body)
                .fontWeight(alert.status == .unread ? .semibold : .medium)
                .lineLimit(1)

            Spacer(minLength: Theme.Spacing.sm)

            Text(PriceFormatter.relativeDate(alert.matchedAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    private var contextRow: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Label(presentation.type.title, systemImage: presentation.type.icon)
                .font(.caption.weight(.medium))
                .foregroundStyle(presentation.type.tint)

            if let district = alert.listing?.districtName ?? alert.listing?.city {
                Label(district, systemImage: "mappin")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let filterName = alert.filterName {
                Label(filterName, systemImage: "line.3.horizontal.decrease.circle")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
        }
    }

    private var summaryRow: some View {
        Text(presentation.reasonSummary)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(2)
    }

    @ViewBuilder
    private var metadataRow: some View {
        HStack(spacing: Theme.Spacing.sm) {
            if let listing = alert.listing {
                Text(PriceFormatter.format(eur: listing.listPriceEur))
                    .font(.caption.monospacedDigit().bold())

                if let pct = listing.lastPriceChangePct, pct != 0 {
                    PriceTrendBadge(changePct: pct)
                }

                if let area = listing.livingAreaSqm {
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

            Spacer(minLength: Theme.Spacing.sm)

            if alert.status != .unread {
                Label(presentation.status.title, systemImage: presentation.status.icon)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}
