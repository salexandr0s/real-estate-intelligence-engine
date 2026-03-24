import Charts
import SwiftUI

/// Line chart showing district price trends with P25–P75 confidence bands.
struct DashboardPriceTrendChart: View {
    let data: [DistrictTrendPoint]

    private var chartData: [DistrictTrendPoint] {
        let countByDistrict = Dictionary(grouping: data, by: \.districtNo)
            .mapValues(\.count)
            .sorted { $0.value > $1.value }
        let topDistricts = Set(countByDistrict.prefix(5).map(\.key))
        return data.filter { topDistricts.contains($0.districtNo) }
    }

    /// Latest data point per district for endpoint annotations.
    private var latestPoints: [Int: DistrictTrendPoint] {
        var result: [Int: DistrictTrendPoint] = [:]
        for point in chartData {
            if let existing = result[point.districtNo] {
                if point.parsedDate > existing.parsedDate {
                    result[point.districtNo] = point
                }
            } else {
                result[point.districtNo] = point
            }
        }
        return result
    }

    private func districtLabel(_ districtNo: Int) -> String {
        if let entry = ViennaDistricts.all.first(where: { $0.number == districtNo }) {
            return entry.name
        }
        return "District \(districtNo)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Label("Price Trends", systemImage: "chart.line.uptrend.xyaxis")
                .font(.subheadline.weight(.semibold))

            if data.isEmpty {
                Text("No trend data yet")
                    .font(.caption).foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, minHeight: 100)
            } else {
                Chart {
                    ForEach(chartData) { point in
                        let label = districtLabel(point.districtNo)

                        // P25–P75 confidence band
                        if let p25 = point.avgP25, let p75 = point.avgP75 {
                            AreaMark(
                                x: .value("Date", point.parsedDate),
                                yStart: .value("P25", p25),
                                yEnd: .value("P75", p75)
                            )
                            .foregroundStyle(by: .value("District", label))
                            .opacity(0.08)
                            .interpolationMethod(.catmullRom)
                        }

                        // Price trend line
                        LineMark(
                            x: .value("Date", point.parsedDate),
                            y: .value("EUR/m\u{00B2}", point.avgMedianPpsqm)
                        )
                        .foregroundStyle(by: .value("District", label))
                        .interpolationMethod(.catmullRom)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                    }

                    // Endpoint dots with current value
                    ForEach(Array(latestPoints.values), id: \.id) { point in
                        PointMark(
                            x: .value("Date", point.parsedDate),
                            y: .value("EUR/m\u{00B2}", point.avgMedianPpsqm)
                        )
                        .foregroundStyle(by: .value("District", districtLabel(point.districtNo)))
                        .symbolSize(20)
                        .annotation(position: .top, spacing: 2) {
                            Text(PriceFormatter.formatCompact(Int(point.avgMedianPpsqm)))
                                .font(.system(size: 8).monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: .month, count: 2)) { _ in
                        AxisGridLine()
                        AxisValueLabel(format: .dateTime.month(.abbreviated))
                            .font(.system(size: 9))
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                        AxisGridLine()
                        AxisValueLabel {
                            if let v = value.as(Double.self) {
                                Text(PriceFormatter.formatCompact(Int(v)))
                                    .font(.system(size: 9))
                            }
                        }
                    }
                }
                .chartLegend(position: .bottom, alignment: .leading, spacing: Theme.Spacing.xs)
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.cardBackground)
        .clipShape(.rect(cornerRadius: Theme.Radius.lg))
        .shadow(color: .black.opacity(0.06), radius: 2, y: 1)
    }
}
