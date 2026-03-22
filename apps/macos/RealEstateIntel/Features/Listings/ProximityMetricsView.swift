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
                // Transit — show nearest of each type
                if let ubahn = nearest(for: .ubahn) {
                    ProximityRow(
                        icon: "tram.fill",
                        color: .blue,
                        text: walkTimeText(ubahn, label: "U-Bahn"),
                        detail: ubahn.poi.name
                    )
                }
                if let tram = nearest(for: .tram) {
                    ProximityRow(
                        icon: "cablecar.fill",
                        color: .cyan,
                        text: walkTimeText(tram, label: "tram"),
                        detail: tram.poi.name
                    )
                }
                if let bus = nearest(for: .bus) {
                    ProximityRow(
                        icon: "bus.fill",
                        color: .indigo,
                        text: walkTimeText(bus, label: "bus"),
                        detail: bus.poi.name
                    )
                }

                // Daily life
                let marketCount = count(for: .supermarket)
                if marketCount > 0 {
                    ProximityRow(
                        icon: "cart.fill",
                        color: .mint,
                        text: "\(marketCount) supermarket\(marketCount == 1 ? "" : "s") within 500m",
                        detail: nil
                    )
                }

                let docCount = count(for: .doctor)
                if docCount > 0 {
                    ProximityRow(
                        icon: "stethoscope",
                        color: .purple,
                        text: "\(docCount) doctor\(docCount == 1 ? "" : "s") within 500m",
                        detail: nil
                    )
                }

                let hospitalCount = nearbyPOIs.count(where: { $0.poi.category == .hospital && $0.distanceM <= 2000 })
                if hospitalCount > 0 {
                    ProximityRow(
                        icon: "cross.case.fill",
                        color: .pink,
                        text: "Hospital within 2km",
                        detail: nil
                    )
                }

                // Parks
                let parkCount = count(for: .park)
                if parkCount > 0 {
                    ProximityRow(
                        icon: "leaf.fill",
                        color: .green,
                        text: "\(parkCount) park\(parkCount == 1 ? "" : "s") within 500m",
                        detail: nil
                    )
                }

                // Education
                let eduCount = count(for: .school)
                if eduCount > 0 {
                    ProximityRow(
                        icon: "book.fill",
                        color: .orange,
                        text: "\(eduCount) school\(eduCount == 1 ? "" : "s") within 500m",
                        detail: nil
                    )
                }

                // Safety
                let policeCount = nearbyPOIs.count(where: { $0.poi.category == .police && $0.distanceM <= 1000 })
                let fireCount = nearbyPOIs.count(where: { $0.poi.category == .fireStation && $0.distanceM <= 1000 })
                if policeCount > 0 || fireCount > 0 {
                    let parts = [
                        policeCount > 0 ? "\(policeCount) police" : nil,
                        fireCount > 0 ? "\(fireCount) fire" : nil,
                    ].compactMap { $0 }.joined(separator: " + ")
                    ProximityRow(
                        icon: "shield.fill",
                        color: .gray,
                        text: "\(parts) within 1km",
                        detail: nil
                    )
                }
            }
        }
    }

    private func nearest(for category: POICategory) -> (poi: POI, distanceM: Double)? {
        nearbyPOIs.first { $0.poi.category == category }
    }

    private func count(for category: POICategory) -> Int {
        nearbyPOIs.count(where: { $0.poi.category == category && $0.distanceM <= 500 })
    }

    private func walkTimeText(_ entry: (poi: POI, distanceM: Double), label: String) -> String {
        let minutes = max(1, Int(entry.distanceM / 80)) // ~80m per minute walking
        return "\(minutes) min walk to \(label)"
    }
}

/// A single row in the proximity metrics showing an icon, description, and optional detail.
struct ProximityRow: View {
    let icon: String
    let color: Color
    let text: String
    let detail: String?

    var body: some View {
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
