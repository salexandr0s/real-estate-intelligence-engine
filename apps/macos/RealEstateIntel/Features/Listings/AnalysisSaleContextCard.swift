import SwiftUI

/// Card showing sale comparable statistics — median, P25, P75 price per sqm.
struct AnalysisSaleContextCard: View {
    let sale: AnalysisMarketContext

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Sale Comparables")
                .font(.subheadline)
                .fontWeight(.medium)

            HStack(spacing: Theme.Spacing.lg) {
                if let median = sale.medianPpsqm {
                    MetricCell(label: "Median €/m²", value: PriceFormatter.format(eur: median))
                }
                if let p25 = sale.p25Ppsqm {
                    MetricCell(label: "P25", value: PriceFormatter.format(eur: p25))
                }
                if let p75 = sale.p75Ppsqm {
                    MetricCell(label: "P75", value: PriceFormatter.format(eur: p75))
                }
            }

            HStack(spacing: Theme.Spacing.sm) {
                StatusBadge(label: sale.confidence.capitalized, color: Theme.confidenceColor(for: sale.confidence))
                Text("\(sale.sampleSize) comps · \(sale.fallbackLevel)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .cardStyle()
    }
}
