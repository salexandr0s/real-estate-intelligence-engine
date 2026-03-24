import Charts
import SwiftUI

/// Horizontal bar chart showing average price/sqm by district with min–max range.
struct DistrictComparisonChart: View {
    let data: [DistrictComparison]

    /// Top 12 districts by average price, descending.
    private var topData: [DistrictComparison] {
        Array(data.sorted { $0.avgPricePerSqm > $1.avgPricePerSqm }.prefix(12))
    }

    private var priceRange: (min: Double, max: Double) {
        let prices = topData.map(\.avgPricePerSqm)
        return (prices.min() ?? 0, prices.max() ?? 1)
    }

    private func districtLabel(_ districtNo: Int) -> String {
        if let entry = ViennaDistricts.all.first(where: { $0.number == districtNo }) {
            return "\(districtNo). \(entry.name)"
        }
        return "District \(districtNo)"
    }

    /// Gradient from teal (affordable) → indigo (expensive) based on position in range.
    private func barColor(for price: Double) -> Color {
        let range = priceRange
        let span = max(range.max - range.min, 1)
        let t = (price - range.min) / span
        if t < 0.5 {
            return Color.teal.opacity(0.7 + t * 0.3)
        } else {
            return Color.indigo.opacity(0.5 + (t - 0.5) * 0.5)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Label("Avg. Price/m\u{00B2} by District", systemImage: "building.2.fill")
                .font(.subheadline.weight(.semibold))

            if data.isEmpty {
                Text("No data available")
                    .font(.caption).foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                Chart(topData) { district in
                    // Min-max range line behind the bar
                    RuleMark(
                        xStart: .value("Min", district.minPricePerSqm),
                        xEnd: .value("Max", district.maxPricePerSqm),
                        y: .value("District", districtLabel(district.districtNo))
                    )
                    .foregroundStyle(.secondary.opacity(0.25))
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))

                    // Average price bar
                    BarMark(
                        x: .value("EUR/m²", district.avgPricePerSqm),
                        y: .value("District", districtLabel(district.districtNo))
                    )
                    .foregroundStyle(barColor(for: district.avgPricePerSqm))
                    .cornerRadius(3)
                    .annotation(position: .trailing, spacing: 4) {
                        Text("\(district.listingCount)")
                            .font(.system(size: 8).monospacedDigit())
                            .foregroundStyle(.tertiary)
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { value in
                        AxisGridLine()
                        AxisValueLabel {
                            if let v = value.as(Double.self) {
                                Text(PriceFormatter.formatCompact(Int(v)))
                                    .font(.system(size: 9))
                            }
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks { _ in
                        AxisValueLabel()
                            .font(.system(size: 9))
                    }
                }
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.cardBackground)
        .clipShape(.rect(cornerRadius: Theme.Radius.lg))
        .shadow(color: .black.opacity(0.06), radius: 2, y: 1)
    }
}
