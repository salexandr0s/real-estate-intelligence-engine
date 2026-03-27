import AppKit
import SwiftUI

struct CrossSourceComparisonBlockView: View {
    let data: CrossSourceComparisonData
    let onListingTap: (Int) -> Void

    private var uniqueMembers: [CrossSourceComparisonMember] {
        var seenSourceCodes = Set<String>()
        var uniqueMembers: [CrossSourceComparisonMember] = []

        for member in data.members {
            if seenSourceCodes.insert(member.sourceCode.lowercased()).inserted {
                uniqueMembers.append(member)
            }
        }

        return uniqueMembers
    }

    private var orderedMembers: [CrossSourceComparisonMember] {
        let subject = uniqueMembers.first(where: { $0.isSubject })
        let others = uniqueMembers
            .filter { !$0.isSubject }
            .sorted { lhs, rhs in
                let lhsPrice = lhs.listPriceEur ?? .greatestFiniteMagnitude
                let rhsPrice = rhs.listPriceEur ?? .greatestFiniteMagnitude
                return lhsPrice < rhsPrice
            }

        return (subject.map { [$0] } ?? []) + others
    }

    private var lowestAsk: CrossSourceComparisonMember? {
        uniqueMembers
            .filter { $0.listPriceEur != nil }
            .min { lhs, rhs in
                guard let lhsPrice = lhs.listPriceEur, let rhsPrice = rhs.listPriceEur else { return false }
                return lhsPrice < rhsPrice
            }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            header
            summaryStrip
            ledger
        }
        .copilotArtifactCard(padding: Theme.Spacing.md)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Label("Source verification", systemImage: "checklist.checked")
                    .font(.subheadline.bold())
                Text(data.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("Cluster #\(data.clusterId)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    private var summaryStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Spacing.sm) {
                SummaryBadge(
                    title: "Portals",
                    value: "\(uniqueMembers.count)",
                    tint: .accentColor,
                    icon: "square.stack.3d.up"
                )

                if let spread = data.priceSpreadPct {
                    SummaryBadge(
                        title: "Spread",
                        value: "\(spread.formatted(.number.precision(.fractionLength(1))))%",
                        tint: spread >= 5 ? .orange : .green,
                        icon: "arrow.left.and.right.righttriangle.left.righttriangle.right"
                    )
                }

                if let lowestAsk {
                    SummaryBadge(
                        title: "Lowest ask",
                        value: "\(lowestAsk.sourceName) • \(PriceFormatter.format(eurDouble: lowestAsk.listPriceEur))",
                        tint: .accentColor,
                        icon: "tag"
                    )
                }
            }
            .padding(.vertical, 1)
        }
    }

    private var ledger: some View {
        VStack(alignment: .leading, spacing: 0) {
            CrossSourceHeaderRow()
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, Theme.Spacing.xs)

            Divider()
                .opacity(0.35)

            ForEach(orderedMembers) { member in
                Button {
                    onListingTap(member.listingId)
                } label: {
                    CrossSourceLedgerRow(member: member)
                }
                .buttonStyle(.plain)

                if member.id != orderedMembers.last?.id {
                    Divider()
                        .opacity(0.22)
                        .padding(.leading, Theme.Spacing.sm)
                }
            }
        }
        .copilotArtifactInset(padding: 0)
    }
}

private struct SummaryBadge: View {
    let title: String
    let value: String
    let tint: Color
    let icon: String

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: icon)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(title)
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.primary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(tint.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.sm)
                .strokeBorder(tint.opacity(0.12), lineWidth: 0.5)
        }
    }
}

private struct CrossSourceHeaderRow: View {
    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            Text("Source")
                .frame(width: 220, alignment: .leading)
            Text("Price")
                .frame(width: 110, alignment: .trailing)
            Text("€/m²")
                .frame(width: 110, alignment: .trailing)
            Text("Score")
                .frame(width: 52, alignment: .center)
            Text("First seen")
                .frame(width: 76, alignment: .trailing)
        }
        .font(.caption2.bold())
        .foregroundStyle(.secondary)
    }
}

private struct CrossSourceLedgerRow: View {
    let member: CrossSourceComparisonMember

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            HStack(spacing: Theme.Spacing.sm) {
                SourceLogo(sourceCode: member.sourceCode, size: 20)

                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    HStack(spacing: Theme.Spacing.sm) {
                        Text(member.sourceName)
                            .font(.caption.bold())
                        Text(member.sourceCode.uppercased())
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }

                    Text(member.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                if member.isSubject {
                    Text("Current")
                        .font(.caption2.bold())
                        .padding(.horizontal, Theme.Spacing.xs)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.14), in: Capsule())
                }
            }
            .frame(width: 220, alignment: .leading)

            Text(member.listPriceEur.map(PriceFormatter.format(eurDouble:)) ?? "—")
                .frame(width: 110, alignment: .trailing)
                .font(.caption.monospacedDigit().bold())

            Text(member.pricePerSqmEur.map { PriceFormatter.formatPerSqm($0) } ?? "—")
                .frame(width: 110, alignment: .trailing)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)

            Group {
                if let score = member.currentScore {
                    ScoreIndicator(score: score, size: .compact)
                } else {
                    Text("—")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 52, alignment: .center)

            Text(member.firstSeenAt)
                .frame(width: 76, alignment: .trailing)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.sm)
        .background(rowBackground)
        .overlay(alignment: .leading) {
            if member.isSubject {
                Rectangle()
                    .fill(Color.accentColor)
                    .frame(width: 3)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
        .contextMenu {
            if let url = URL(string: member.canonicalUrl) {
                Button {
                    NSWorkspace.shared.open(url)
                } label: {
                    Label("Open source listing", systemImage: "safari")
                }
            }
        }
    }

    private var rowBackground: some ShapeStyle {
        member.isSubject ? Color.accentColor.opacity(0.06) : Color.clear
    }
}
