import SwiftUI

/// Market temperature heatmap with velocity-scaled visual intensity.
struct MarketHeatGrid: View {
    let data: [MarketTemperaturePoint]
    var onDistrictTap: ((Int) -> Void)?

    @State private var hoveredDistrictNo: Int?

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

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 4)

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Label("Market Temperature", systemImage: "thermometer.medium")
                    .font(.subheadline)
                    .adaptiveFontWeight(.semibold)
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
                        VStack(spacing: 2) {
                            Text("\(point.districtNo)")
                                .font(.caption.monospacedDigit())
                                .adaptiveFontWeight(.bold)
                            Text(point.velocity, format: .number.precision(.fractionLength(1)))
                                .font(.caption2.monospacedDigit())
                                .adaptiveFontWeight(.medium)
                                .foregroundStyle(point.temperatureColor)
                            Text("+\(point.newLast7d)/wk")
                                .font(Theme.chartAxisFont)
                                .foregroundStyle(.tertiary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                        .background(point.temperatureColor.opacity(
                            cellOpacity(for: point) + (hoveredDistrictNo == point.districtNo ? 0.08 : 0)
                        ))
                        .overlay {
                            if hoveredDistrictNo == point.districtNo {
                                RoundedRectangle(cornerRadius: 4)
                                    .strokeBorder(point.temperatureColor.opacity(0.3), lineWidth: 0.5)
                            }
                        }
                        .clipShape(.rect(cornerRadius: 4))
                        .onHover { isHovered in
                            hoveredDistrictNo = isHovered ? point.districtNo : nil
                        }
                        .help(districtName(point.districtNo))
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(districtName(point.districtNo)), velocity \(point.velocity.formatted(.number.precision(.fractionLength(1)))), \(point.newLast7d) new this week")
                        .contextMenu {
                            Button {
                                onDistrictTap?(point.districtNo)
                            } label: {
                                Label("View District Listings", systemImage: "building.2")
                            }
                        }
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
