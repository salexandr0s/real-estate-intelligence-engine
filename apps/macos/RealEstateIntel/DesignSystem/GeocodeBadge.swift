import SwiftUI

/// Badge showing geocode quality/precision level.
struct GeocodeBadge: View {
    let precision: String?

    var body: some View {
        StatusBadge(label: label, color: color)
    }

    private var label: String {
        switch precision {
        case "source_exact": "Exact"
        case "source_approx": "Approximate"
        case "street": "Street-level"
        case "district": "District"
        case "city": "City-level"
        default: "Not geocoded"
        }
    }

    private var color: Color {
        switch precision {
        case "source_exact", "source_approx": .green
        case "street": .orange
        case "district": .orange
        case "city": .red
        default: .red
        }
    }
}
