import SwiftUI

/// Color-coded district grid showing market velocity/temperature.
struct MarketTemperatureView: View {
    let data: [MarketTemperaturePoint]
    @Binding var selectedDistrictNo: Int?

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

            if let selectedDistrictNo {
                HStack(spacing: Theme.Spacing.sm) {
                    Label("Focused district", systemImage: "scope")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(ViennaDistricts.label(for: selectedDistrictNo))
                        .font(.caption.monospacedDigit().weight(.semibold))
                    Spacer()
                    Button("Show all") {
                        self.selectedDistrictNo = nil
                    }
                    .buttonStyle(.link)
                    .font(.caption)
                }
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, Theme.Spacing.xs)
                .background(Color.primary.opacity(0.04), in: Capsule())
            }

            if data.isEmpty {
                ContentUnavailableView {
                    Label("No Temperature Data", systemImage: "thermometer.medium")
                } description: {
                    Text("Temperature data will appear once active listings exist across districts.")
                }
                .frame(minHeight: 250)
            } else if filteredData.isEmpty {
                ContentUnavailableView {
                    Label("No District Temperature Data", systemImage: "thermometer.low")
                } description: {
                    Text(
                        selectedDistrictNo.map { districtNo in
                            "\(ViennaDistricts.label(for: districtNo)) has no temperature snapshot yet."
                        } ?? "Temperature data is currently unavailable for this district."
                    )
                }
                .frame(minHeight: 250)
            } else {
                LazyVGrid(columns: columns, spacing: Theme.Spacing.md) {
                    ForEach(filteredData) { point in
                        TemperatureCard(
                            point: point,
                            isSelected: selectedDistrictNo == point.districtNo,
                            onSelect: {
                                if selectedDistrictNo == point.districtNo {
                                    selectedDistrictNo = nil
                                } else {
                                    selectedDistrictNo = point.districtNo
                                }
                            }
                        )
                    }
                }
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.84), value: selectedDistrictNo)
    }

    private var filteredData: [MarketTemperaturePoint] {
        guard let selectedDistrictNo else { return data }
        return data.filter { $0.districtNo == selectedDistrictNo }
    }
}

// MARK: - Temperature Card

private struct TemperatureCard: View {
    let point: MarketTemperaturePoint
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
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
                    .stroke(point.temperatureColor.opacity(isSelected ? 0.75 : 0.3), lineWidth: isSelected ? 1.5 : 1)
            }
            .shadow(color: point.temperatureColor.opacity(isSelected ? 0.18 : 0.06), radius: isSelected ? 12 : Theme.cardShadowRadius, y: isSelected ? 6 : Theme.cardShadowY)
            .scaleEffect(isSelected ? 1.01 : 1)
        }
        .buttonStyle(.plain)
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
