import SwiftUI
import Charts

/// Generic chart renderer for line and bar charts from copilot data.
struct ChartBlock: View {
    let data: ChartBlockData

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text(data.title)
                .font(.subheadline.bold())

            Chart {
                ForEach(data.series) { series in
                    ForEach(series.dataPoints) { point in
                        switch data.chartType {
                        case .bar:
                            BarMark(
                                x: .value("Category", point.label),
                                y: .value("Value", point.value)
                            )
                            .foregroundStyle(by: .value("Series", series.label))

                        case .line:
                            LineMark(
                                x: .value("Category", point.label),
                                y: .value("Value", point.value)
                            )
                            .foregroundStyle(by: .value("Series", series.label))

                            PointMark(
                                x: .value("Category", point.label),
                                y: .value("Value", point.value)
                            )
                            .foregroundStyle(by: .value("Series", series.label))
                        }
                    }
                }
            }
            .chartLegend(data.series.count > 1 ? .visible : .hidden)
            .frame(minHeight: 180)
        }
        .copilotArtifactCard(padding: Theme.Spacing.md)
    }
}
