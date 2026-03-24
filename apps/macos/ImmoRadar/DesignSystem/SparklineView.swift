import Charts
import SwiftUI

/// Tiny inline chart for embedding in summary cards.
/// Shows a smooth line with gradient area fill, no axes or labels.
struct SparklineView: View {
    let data: [Int]
    var color: Color = .blue

    private var accessibilityDescription: String {
        guard data.count >= 2,
              let lo = data.min(), let hi = data.max() else {
            return "Trend chart, no data"
        }
        return "\(data.count)-day trend, \(lo) to \(hi)"
    }

    var body: some View {
        if data.count >= 2 {
            Chart(Array(data.enumerated()), id: \.offset) { index, value in
                LineMark(
                    x: .value("Day", index),
                    y: .value("Count", value)
                )
                .foregroundStyle(color)
                .interpolationMethod(.catmullRom)

                AreaMark(
                    x: .value("Day", index),
                    y: .value("Count", value)
                )
                .foregroundStyle(
                    LinearGradient(
                        colors: [color.opacity(0.2), color.opacity(0.02)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .interpolationMethod(.catmullRom)
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartLegend(.hidden)
            .frame(width: 88, height: 28)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityDescription)
        }
    }
}
