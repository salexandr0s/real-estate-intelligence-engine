import SwiftUI

/// Card showing gross yield, price-to-rent ratio, and sensitivity bands.
struct AnalysisInvestorMetricsCard: View {
    let metrics: AnalysisInvestorMetrics

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Investor Metrics")
                .font(.subheadline)
                .fontWeight(.medium)

            HStack(spacing: Theme.Spacing.lg) {
                if let yield = metrics.grossYield.value {
                    MetricCell(
                        label: "Gross Yield",
                        value: yield.formatted(.number.precision(.fractionLength(2))) + "%"
                    )
                }
                if let ptr = metrics.priceToRent {
                    MetricCell(
                        label: "Price/Rent",
                        value: ptr.formatted(.number.precision(.fractionLength(1))) + "x"
                    )
                }
            }

            if metrics.sensitivityBands.low != nil || metrics.sensitivityBands.high != nil {
                HStack(spacing: Theme.Spacing.lg) {
                    if let low = metrics.sensitivityBands.low {
                        MetricCell(
                            label: "Yield Low",
                            value: low.formatted(.number.precision(.fractionLength(2))) + "%"
                        )
                    }
                    if let base = metrics.sensitivityBands.base {
                        MetricCell(
                            label: "Yield Base",
                            value: base.formatted(.number.precision(.fractionLength(2))) + "%"
                        )
                    }
                    if let high = metrics.sensitivityBands.high {
                        MetricCell(
                            label: "Yield High",
                            value: high.formatted(.number.precision(.fractionLength(2))) + "%"
                        )
                    }
                }
            }

            if !metrics.grossYield.assumptions.isEmpty {
                Text(metrics.grossYield.assumptions.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .cardStyle()
    }
}
