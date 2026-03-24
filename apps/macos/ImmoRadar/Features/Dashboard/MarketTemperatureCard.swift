import SwiftUI

/// Compact dashboard card showing the hottest/coolest districts by listing velocity.
struct MarketTemperatureCard: View {
    let data: [MarketTemperaturePoint]

    private var topDistricts: [MarketTemperaturePoint] {
        Array(data.sorted { $0.velocity > $1.velocity }.prefix(5))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Image(systemName: "thermometer.medium")
                    .foregroundStyle(.orange)
                Text("Market Temperature")
                    .font(.headline)
            }

            if topDistricts.isEmpty {
                Text("No data available")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, Theme.Spacing.lg)
            } else {
                ForEach(topDistricts) { point in
                    HStack(spacing: Theme.Spacing.sm) {
                        Circle()
                            .fill(point.temperatureColor)
                            .frame(width: 8, height: 8)

                        Text(point.districtLabel)
                            .font(.caption)
                            .frame(width: 80, alignment: .leading)

                        Text(point.temperatureLabel)
                            .font(.caption2.bold())
                            .foregroundStyle(point.temperatureColor)
                            .frame(width: 40)

                        Spacer()

                        Text("\(point.newLast7d) new")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)

                        Text(PriceFormatter.formatPerSqm(point.currentAvgPpsqm) + "/m²")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.tertiary)
                    }

                    if point.id != topDistricts.last?.id {
                        Divider()
                    }
                }
            }
        }
        .cardStyle(padding: Theme.Spacing.md, cornerRadius: Theme.Radius.md)
    }
}
