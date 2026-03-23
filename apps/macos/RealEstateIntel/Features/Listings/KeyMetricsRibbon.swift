import SwiftUI

/// Compact ribbon showing the top 3 investor metrics: Gross Yield, Discount to District, Price/Rent.
/// Each cell renders independently based on data availability.
struct KeyMetricsRibbon: View {
    let analysis: ListingAnalysis?
    let explanation: ScoreExplanation?

    var body: some View {
        HStack(spacing: Theme.Spacing.lg) {
            if let yield = analysis?.investorMetrics?.grossYield.value {
                MetricCell(
                    label: "Gross Yield",
                    value: yield.formatted(.number.precision(.fractionLength(2))) + "%"
                )
            }

            if let discount = explanation?.discountToDistrictPct {
                MetricCell(
                    label: "Discount to District",
                    value: PriceFormatter.formatPercent(discount)
                )
            }

            if let ptr = analysis?.investorMetrics?.priceToRent {
                MetricCell(
                    label: "Price/Rent",
                    value: ptr.formatted(.number.precision(.fractionLength(1))) + "x"
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }
}

#Preview("Full data") {
    KeyMetricsRibbon(
        analysis: nil,
        explanation: nil
    )
    .padding()
    .frame(width: 360)
}
