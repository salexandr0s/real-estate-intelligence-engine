import SwiftUI
import Charts

/// Renders a price history line chart using Swift Charts.
struct PriceHistoryBlock: View {
    let data: PriceHistoryData

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Price History")
                .font(.subheadline.bold())

            if data.dataPoints.count >= 2 {
                Chart(data.dataPoints) { point in
                    LineMark(
                        x: .value("Date", point.date),
                        y: .value("Price", point.priceEur)
                    )
                    .foregroundStyle(Color.accentColor)

                    PointMark(
                        x: .value("Date", point.date),
                        y: .value("Price", point.priceEur)
                    )
                    .foregroundStyle(Color.accentColor)
                    .annotation(position: .top, spacing: 4) {
                        Text(PriceFormatter.format(eur: point.priceEur))
                            .font(.system(size: 8).monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading) { value in
                        AxisValueLabel {
                            if let eur = value.as(Int.self) {
                                Text(PriceFormatter.format(eur: eur))
                                    .font(.caption2.monospacedDigit())
                            }
                        }
                    }
                }
                .frame(minHeight: 160)
            } else {
                // Single data point — show as text
                ForEach(data.dataPoints) { point in
                    HStack {
                        Text(PriceFormatter.formatDate(point.date))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(PriceFormatter.format(eur: point.priceEur))
                            .font(.caption.monospacedDigit().bold())
                    }
                }
            }
        }
        .copilotArtifactCard(padding: Theme.Spacing.md)
    }
}
