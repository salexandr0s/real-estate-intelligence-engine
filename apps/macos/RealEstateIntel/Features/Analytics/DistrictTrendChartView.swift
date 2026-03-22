import Charts
import SwiftUI

/// Line chart showing district price/sqm trends over time.
struct DistrictTrendChartView: View {
    let data: [DistrictTrendPoint]
    var onMonthsChanged: ((Int) -> Void)?
    @State private var selectedMonths: Int = 12
    @State private var selectedDistrict: Int? = nil

    private var filteredData: [DistrictTrendPoint] {
        var result = data
        if let district = selectedDistrict {
            result = result.filter { $0.districtNo == district }
        }
        // Client-side date filter as safety net
        let cutoff = Calendar.current.date(byAdding: .month, value: -selectedMonths, to: .now) ?? .distantPast
        return result.filter { $0.parsedDate >= cutoff }
    }

    private var availableDistricts: [Int] {
        Array(Set(data.map(\.districtNo))).sorted()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Text("Price Trends")
                    .font(.headline)

                Spacer()

                Picker("District", selection: $selectedDistrict) {
                    Text("All Districts").tag(nil as Int?)
                    ForEach(availableDistricts, id: \.self) { d in
                        Text("District \(d)").tag(d as Int?)
                    }
                }
                .frame(width: 160)

                Picker("Period", selection: $selectedMonths) {
                    Text("3 months").tag(3)
                    Text("6 months").tag(6)
                    Text("12 months").tag(12)
                }
                .pickerStyle(.segmented)
                .frame(width: 240)
            }

            if filteredData.isEmpty {
                ContentUnavailableView {
                    Label("No Trend Data", systemImage: "chart.line.downtrend.xyaxis")
                } description: {
                    Text("Trend data will appear once baselines have been computed over multiple dates.")
                }
                .frame(minHeight: 250)
            } else {
                Chart(filteredData) { point in
                    LineMark(
                        x: .value("Date", point.parsedDate),
                        y: .value("EUR/m²", point.avgMedianPpsqm)
                    )
                    .foregroundStyle(by: .value("District", "District \(point.districtNo)"))
                    .interpolationMethod(.catmullRom)

                    if let p25 = point.avgP25, let p75 = point.avgP75,
                       selectedDistrict != nil {
                        AreaMark(
                            x: .value("Date", point.parsedDate),
                            yStart: .value("P25", p25),
                            yEnd: .value("P75", p75)
                        )
                        .foregroundStyle(.gray.opacity(0.1))
                    }
                }
                .chartYAxisLabel("EUR/m²")
                .chartXAxis {
                    AxisMarks(values: .stride(by: .month)) { _ in
                        AxisGridLine()
                        AxisValueLabel(format: .dateTime.month(.abbreviated).year(.twoDigits))
                    }
                }
                .frame(minHeight: 300)
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .shadow(radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
        .onChange(of: selectedMonths) { _, newValue in
            onMonthsChanged?(newValue)
        }
    }
}
