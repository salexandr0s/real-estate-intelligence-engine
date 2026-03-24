import SwiftUI

/// Card showing market rent estimate with low/mid/high range and confidence.
struct AnalysisMarketRentCard: View {
    let rent: AnalysisMarketRentEstimate

    var body: some View {
        if rent.estimateMid != nil {
            fullCard
        } else {
            compactEmpty
        }
    }

    private var fullCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Market Rent Estimate")
                .font(.subheadline)
                .fontWeight(.medium)

            if let mid = rent.estimateMid {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xs) {
                    Text(PriceFormatter.format(eurDouble: mid))
                        .font(.title3)
                        .fontWeight(.semibold)
                    Text("/month")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: Theme.Spacing.lg) {
                if let low = rent.estimateLow {
                    MetricCell(label: "Low", value: PriceFormatter.format(eurDouble: low))
                }
                if let high = rent.estimateHigh {
                    MetricCell(label: "High", value: PriceFormatter.format(eurDouble: high))
                }
                if let psqm = rent.eurPerSqmMid {
                    MetricCell(
                        label: "€/m²",
                        value: psqm.formatted(.number.precision(.fractionLength(1)))
                    )
                }
            }

            HStack(spacing: Theme.Spacing.sm) {
                StatusBadge(label: rent.confidence.capitalized, color: Theme.confidenceColor(for: rent.confidence))
                Text("\(rent.sampleSize) comps · \(rent.fallbackLevel)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }

    /// Compact inline display when no rent estimate is available.
    private var compactEmpty: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Text("Market Rent")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            StatusBadge(label: rent.confidence.capitalized, color: Theme.confidenceColor(for: rent.confidence))
            Text("\(rent.sampleSize) comps · \(rent.fallbackLevel)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }
}
