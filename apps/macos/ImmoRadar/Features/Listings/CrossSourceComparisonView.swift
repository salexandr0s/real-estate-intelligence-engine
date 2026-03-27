import SwiftUI

/// Side-by-side comparison of the same listing across different sources.
struct CrossSourceComparisonView: View {
    let cluster: ListingCluster

    private var members: [ClusterMember] {
        cluster.deduplicatedMembers
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Image(systemName: "arrow.triangle.branch")
                    .foregroundStyle(.blue)
                Text("Cross-Source Comparison")
                    .font(.caption.bold())
                Text("\(members.count) portals")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if let spread = cluster.priceSpreadPct, spread > 0 {
                    Spacer()
                    Text("Price spread: \(spread.formatted(.number.precision(.fractionLength(1))))%")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }

            ForEach(members) { member in
                HStack(alignment: .center, spacing: Theme.Spacing.sm) {
                    SourceLogo(sourceCode: member.sourceCode, size: 16)

                    Text(member.sourceCode.uppercased())
                        .font(.caption.bold())
                        .frame(width: 68, alignment: .leading)

                    Text(member.listPriceEur.map { PriceFormatter.format(eur: Int($0)) } ?? "—")
                        .font(.caption.monospacedDigit())
                        .frame(width: 110, alignment: .trailing)

                    Text(member.pricePerSqmEur.map(PriceFormatter.formatPerSqm) ?? "—")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 106, alignment: .trailing)

                    Group {
                        if let score = member.currentScore {
                            Text("\(Int(score.rounded()))")
                                .font(.caption2.monospacedDigit())
                                .adaptiveFontWeight(.semibold)
                                .foregroundStyle(Theme.scoreColor(for: score))
                        } else {
                            Text("—")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(width: 34, alignment: .trailing)

                    Spacer(minLength: 0)

                    if let url = URL(string: member.canonicalUrl) {
                        Link(destination: url) {
                            Image(systemName: "arrow.up.right.square")
                                .font(.caption)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 3)

                if member.id != members.last?.id {
                    Divider()
                }
            }
        }
        .padding(Theme.Spacing.md)
        .background(Color.blue.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .stroke(Color.blue.opacity(0.15), lineWidth: 1)
        }
    }
}
