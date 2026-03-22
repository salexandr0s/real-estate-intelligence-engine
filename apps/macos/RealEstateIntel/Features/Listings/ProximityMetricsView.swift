import SwiftUI

/// Displays structured proximity metrics grouped by POI category.
struct ProximityMetricsView: View {
    let nearbyPOIs: [(poi: POI, distanceM: Double)]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            if nearbyPOIs.isEmpty {
                Text("No points of interest nearby")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else {
                // Nearest transit
                if let nearest = nearestTransit {
                    proximityRow(
                        icon: "tram.fill",
                        color: .blue,
                        text: walkTimeText(nearest),
                        detail: nearest.poi.name
                    )
                }

                // Parks count
                let parkCount = count(for: .park)
                if parkCount > 0 {
                    proximityRow(
                        icon: "leaf.fill",
                        color: .green,
                        text: "\(parkCount) park\(parkCount == 1 ? "" : "s") within 500m",
                        detail: nil
                    )
                }

                // Schools/kindergartens
                let eduCount = count(for: .school)
                if eduCount > 0 {
                    proximityRow(
                        icon: "book.fill",
                        color: .orange,
                        text: "\(eduCount) school\(eduCount == 1 ? "" : "s") within 500m",
                        detail: nil
                    )
                }

                // Police
                let policeCount = nearbyPOIs.filter { $0.poi.category == .police && $0.distanceM <= 1000 }.count
                if policeCount > 0 {
                    proximityRow(
                        icon: "shield.fill",
                        color: .gray,
                        text: "\(policeCount) police station\(policeCount == 1 ? "" : "s") within 1km",
                        detail: nil
                    )
                }
            }
        }
    }

    private var nearestTransit: (poi: POI, distanceM: Double)? {
        nearbyPOIs.first { $0.poi.category == .transit }
    }

    private func count(for category: POICategory) -> Int {
        nearbyPOIs.filter { $0.poi.category == category && $0.distanceM <= 500 }.count
    }

    private func walkTimeText(_ entry: (poi: POI, distanceM: Double)) -> String {
        let minutes = max(1, Int(entry.distanceM / 80)) // ~80m per minute walking
        let typeLabel = entry.poi.subcategory == "u-bahn" ? "U-Bahn" : "transit"
        return "\(minutes) min walk to \(typeLabel)"
    }

    private func proximityRow(icon: String, color: Color, text: String, detail: String?) -> some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: icon)
                .font(.caption2)
                .foregroundStyle(color)
                .frame(width: 14)

            VStack(alignment: .leading, spacing: 0) {
                Text(text)
                    .font(.caption)
                if let detail {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
