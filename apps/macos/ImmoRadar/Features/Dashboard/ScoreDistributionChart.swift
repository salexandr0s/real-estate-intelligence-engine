import Charts
import SwiftUI

/// Histogram showing listing score distribution with zero-filled buckets.
struct ScoreDistributionChart: View {
    let data: [ScoreDistributionBucket]

    private static let allBuckets = ["0-19", "20-39", "40-59", "60-79", "80-100"]

    private func barColor(for bucket: String) -> Color {
        switch bucket {
        case "80-100": .scoreExcellent
        case "60-79": .scoreGood
        case "40-59": .scoreAverage
        case "20-39": .scorePoor
        case "0-19": .scorePoor.opacity(0.6)
        default: .gray
        }
    }

    /// Zero-fill missing buckets so the full spectrum always renders.
    private var filledData: [ScoreDistributionBucket] {
        let existing = Dictionary(data.map { ($0.bucket, $0.count) }, uniquingKeysWith: { a, _ in a })
        return Self.allBuckets.map { bucket in
            ScoreDistributionBucket(bucket: bucket, count: existing[bucket] ?? 0)
        }
    }

    private var totalCount: Int {
        filledData.reduce(0) { $0 + $1.count }
    }

    private func percentage(for count: Int) -> String {
        guard totalCount > 0 else { return "0%" }
        let pct = Double(count) / Double(totalCount) * 100
        return pct >= 1 ? "\(Int(pct))%" : "<1%"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Label("Score Distribution", systemImage: "chart.bar.fill")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if totalCount > 0 {
                    Text("\(totalCount) total")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            if data.isEmpty {
                Text("No data available")
                    .font(.caption).foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                Chart(filledData) { bucket in
                    BarMark(
                        x: .value("Bucket", bucket.bucket),
                        y: .value("Count", bucket.count)
                    )
                    .foregroundStyle(barColor(for: bucket.bucket))
                    .clipShape(.rect(cornerRadius: 3))
                    .annotation(position: .top, spacing: 1) {
                        if bucket.count > 0 {
                            Text(percentage(for: bucket.count))
                                .font(Theme.chartAnnotationFont)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks { _ in AxisValueLabel().font(Theme.chartAxisFont) }
                }
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(Theme.chartAxisFont)
                    }
                }
                .accessibilityLabel("Score distribution, \(totalCount) listings")
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.cardBackground)
        .clipShape(.rect(cornerRadius: Theme.Radius.lg))
    }
}
