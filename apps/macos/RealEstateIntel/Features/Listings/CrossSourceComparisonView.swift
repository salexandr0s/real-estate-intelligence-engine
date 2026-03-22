import SwiftUI

/// Side-by-side comparison of the same listing across different sources.
struct CrossSourceComparisonView: View {
    let cluster: ListingCluster

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Image(systemName: "arrow.triangle.branch")
                    .foregroundStyle(.blue)
                Text("Cross-Source Comparison")
                    .font(.caption.bold())
                if let spread = cluster.priceSpreadPct, spread > 0 {
                    Spacer()
                    Text("Price spread: \(String(format: "%.1f%%", spread))")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }

            ForEach(cluster.members) { member in
                HStack(spacing: Theme.Spacing.md) {
                    SourceLogo(sourceCode: member.sourceCode)
                        .frame(width: 20, height: 20)

                    Text(member.sourceCode)
                        .font(.caption.bold())
                        .frame(width: 80, alignment: .leading)

                    if let price = member.listPriceEur {
                        Text(PriceFormatter.format(eur: Int(price)))
                            .font(.caption.monospacedDigit())
                            .frame(width: 100, alignment: .trailing)
                    } else {
                        Text("—")
                            .font(.caption)
                            .frame(width: 100, alignment: .trailing)
                    }

                    if let ppsqm = member.pricePerSqmEur {
                        Text(PriceFormatter.formatPerSqm(ppsqm) + "/m²")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 100, alignment: .trailing)
                    }

                    if let score = member.currentScore {
                        ScoreIndicator(score: score)
                    }

                    Spacer()

                    Link(destination: URL(string: member.canonicalUrl) ?? URL(string: "about:blank")!) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.caption)
                    }
                }
                .padding(.vertical, 2)

                if member.id != cluster.members.last?.id {
                    Divider()
                }
            }
        }
        .padding(Theme.Spacing.md)
        .background(Color.blue.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .stroke(Color.blue.opacity(0.15), lineWidth: 1)
        )
    }
}
