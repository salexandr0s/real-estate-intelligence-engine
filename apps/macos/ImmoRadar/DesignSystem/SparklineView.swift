import Charts
import SwiftUI

/// Tiny inline chart for embedding in summary cards.
/// Shows a smooth line with gradient area fill, no axes or labels.
struct SparklineView: View {
    let data: [Int]
    var color: Color = .blue

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
            .frame(width: 72, height: 24)
        }
    }
}
