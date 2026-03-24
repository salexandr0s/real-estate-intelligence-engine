import SwiftUI

/// Market temperature heatmap with velocity-scaled visual intensity.
struct MarketHeatGrid: View {
    let data: [MarketTemperaturePoint]

    private var sortedData: [MarketTemperaturePoint] {
        data.sorted { $0.velocity > $1.velocity }
    }

    private var maxVelocity: Double {
        data.map(\.velocity).max() ?? 1
    }

    /// Scale opacity by velocity: hotter districts visually pop.
    private func cellOpacity(for point: MarketTemperaturePoint) -> Double {
        let normalized = point.velocity / max(maxVelocity, 1)
        return 0.08 + normalized * 0.35
    }

    private func districtName(_ districtNo: Int) -> String {
        ViennaDistricts.all.first(where: { $0.number == districtNo })?.name ?? "District \(districtNo)"
    }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 5)

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Label("Market Temperature", systemImage: "thermometer.medium")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(data.count) districts")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if data.isEmpty {
                Text("No data")
                    .font(.caption).foregroundStyle(.tertiary)
            } else {
                LazyVGrid(columns: columns, spacing: 4) {
                    ForEach(sortedData) { point in
                        VStack(spacing: 1) {
                            Text("\(point.districtNo)")
                                .font(.system(size: 10, weight: .bold).monospacedDigit())
                            Text(String(format: "%.1f", point.velocity))
                                .font(.system(size: 8, weight: .medium).monospacedDigit())
                                .foregroundStyle(point.temperatureColor)
                            Text("+\(point.newLast7d)/wk")
                                .font(.system(size: 7).monospacedDigit())
                                .foregroundStyle(.tertiary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 3)
                        .background(point.temperatureColor.opacity(cellOpacity(for: point)))
                        .clipShape(.rect(cornerRadius: 4))
                        .help(districtName(point.districtNo))
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
