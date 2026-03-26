import SwiftUI

/// Color-coded district grid showing market velocity/temperature.
struct MarketTemperatureView: View {
    let data: [MarketTemperaturePoint]

    private let columns = [
        GridItem(.adaptive(minimum: 200, maximum: 280), spacing: Theme.Spacing.md)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Text("Market Temperature")
                    .font(.headline)
                Spacer()
                TemperatureLegend()
            }

            if data.isEmpty {
                ContentUnavailableView {
                    Label("No Temperature Data", systemImage: "thermometer.medium")
                } description: {
                    Text("Temperature data will appear once active listings exist across districts.")
                }
                .frame(minHeight: 250)
            } else {
                LazyVGrid(columns: columns, spacing: Theme.Spacing.md) {
                    ForEach(data) { point in
                        TemperatureCard(point: point)
                    }
                }
            }
        }
    }
}

// MARK: - Temperature Card

private struct TemperatureCard: View {
    let point: MarketTemperaturePoint

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text(point.districtLabel)
                    .font(.headline)
                Spacer()
                Text(point.temperatureLabel)
                    .font(.caption.bold())
                    .padding(.horizontal, Theme.Spacing.sm)
                    .padding(.vertical, 2)
                    .background(point.temperatureColor.opacity(0.15))
                    .foregroundStyle(point.temperatureColor)
                    .clipShape(Capsule())
            }

            Divider()

            HStack(spacing: Theme.Spacing.lg) {
                StatColumn(label: "Active", value: "\(point.totalActive)")
                StatColumn(label: "New 7d", value: "\(point.newLast7d)")
                StatColumn(label: "New 30d", value: "\(point.newLast30d)")
            }

            HStack {
                Text("Avg Price/m²")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(PriceFormatter.formatPerSqm(point.currentAvgPpsqm))
                    .font(.caption.monospacedDigit().bold())
            }

            HStack {
                Text("Velocity")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\((point.velocity * 100).formatted(.number.precision(.fractionLength(1))))%")
                    .font(.caption.monospacedDigit().bold())
                    .foregroundStyle(point.temperatureColor)
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .stroke(point.temperatureColor.opacity(0.3), lineWidth: 1)
        }
        .shadow(radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
    }
}

private struct StatColumn: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title3.monospacedDigit().bold())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Legend

private struct TemperatureLegend: View {
    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            LegendDot(color: .red, label: "Hot")
            LegendDot(color: .orange, label: "Warm")
            LegendDot(color: .blue, label: "Cool")
            LegendDot(color: .gray, label: "Cold")
        }
        .font(.caption2)
    }
}

private struct LegendDot: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 3) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(label)
                .foregroundStyle(.secondary)
        }
    }
}
