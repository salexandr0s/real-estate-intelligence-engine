import SwiftUI

/// Displays nearby POI metrics in a 2-column grid with full details.
struct ProximityMetricsView: View {
    let nearbyPOIs: [(poi: POI, distanceM: Double)]

    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        if nearbyPOIs.isEmpty {
            Text("No points of interest nearby")
                .font(.caption)
                .foregroundStyle(.tertiary)
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.sm) {
                // Transit — show nearest of each type
                if let ubahn = nearest(for: .ubahn) {
                    ProximityCell(
                        icon: "tram.fill",
                        color: .blue,
                        text: walkTimeText(ubahn, label: "U-Bahn"),
                        detail: ubahn.poi.name
                    )
                }
                if let tram = nearest(for: .tram) {
                    ProximityCell(
                        icon: "cablecar.fill",
                        color: .cyan,
                        text: walkTimeText(tram, label: "tram"),
                        detail: tram.poi.name
                    )
                }
                if let bus = nearest(for: .bus) {
                    ProximityCell(
                        icon: "bus.fill",
                        color: .indigo,
                        text: walkTimeText(bus, label: "bus"),
                        detail: bus.poi.name
                    )
                }

                // Daily life
                let marketCount = count(for: .supermarket)
                if marketCount > 0 {
                    ProximityCell(
                        icon: "cart.fill",
                        color: .mint,
                        text: "\(marketCount) supermarket\(marketCount == 1 ? "" : "s") within 500m"
                    )
                }

                let docCount = count(for: .doctor)
                if docCount > 0 {
                    ProximityCell(
                        icon: "stethoscope",
                        color: .purple,
                        text: "\(docCount) doctor\(docCount == 1 ? "" : "s") within 500m"
                    )
                }

                let hospitalCount = nearbyPOIs.count(where: { $0.poi.category == .hospital && $0.distanceM <= 2000 })
                if hospitalCount > 0 {
                    ProximityCell(
                        icon: "cross.case.fill",
                        color: .pink,
                        text: "Hospital within 2km"
                    )
                }

                // Parks & Education
                let parkCount = count(for: .park)
                if parkCount > 0 {
                    ProximityCell(
                        icon: "leaf.fill",
                        color: .green,
                        text: "\(parkCount) park\(parkCount == 1 ? "" : "s") within 500m"
                    )
                }

                let eduCount = count(for: .school)
                if eduCount > 0 {
                    ProximityCell(
                        icon: "book.fill",
                        color: .orange,
                        text: "\(eduCount) school\(eduCount == 1 ? "" : "s") within 500m"
                    )
                }

                // Emergency Services
                let policeCount = nearbyPOIs.count(where: { $0.poi.category == .police && $0.distanceM <= 1000 })
                let fireCount = nearbyPOIs.count(where: { $0.poi.category == .fireStation && $0.distanceM <= 1000 })
                if policeCount > 0 || fireCount > 0 {
                    let parts = [
                        policeCount > 0 ? "\(policeCount) police" : nil,
                        fireCount > 0 ? "\(fireCount) fire" : nil,
                    ].compactMap { $0 }.joined(separator: " + ")
                    ProximityCell(
                        icon: "shield.fill",
                        color: .gray,
                        text: "\(parts) within 1km"
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
        let minutes = max(1, Int(entry.distanceM / 80))
        return "\(minutes) min walk to \(label)"
    }
}
