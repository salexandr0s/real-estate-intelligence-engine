import SwiftUI

/// A 2-column grid for displaying label-value metadata pairs in inspector sidebars.
struct InspectorGridSection: View {
    let title: String
    let rows: [(label: String, value: String)]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text(title)
                .font(.headline)

            Grid(alignment: .leading, horizontalSpacing: Theme.Spacing.xl, verticalSpacing: Theme.Spacing.sm) {
                ForEach(Array(stride(from: 0, to: rows.count, by: 2)), id: \.self) { i in
                    GridRow {
                        InspectorGridCell(label: rows[i].label, value: rows[i].value)
                        if i + 1 < rows.count {
                            InspectorGridCell(label: rows[i + 1].label, value: rows[i + 1].value)
                        } else {
                            Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                        }
                    }
                }
            }
        }
    }
}

/// A single label-value cell within the inspector grid.
private struct InspectorGridCell: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline)
                .lineLimit(1)
        }
    }
}

#Preview {
    InspectorGridSection(title: "Details", rows: [
        (label: "Operation", value: "Sale"),
        (label: "Property Type", value: "Apartment"),
        (label: "City", value: "Wien"),
        (label: "District", value: "2. Leopoldstadt"),
        (label: "Postal Code", value: "1020"),
        (label: "Status", value: "Active"),
        (label: "First Seen", value: "20.03.2026 14:32"),
        (label: "Listing UID", value: "8c891f71..."),
    ])
    .padding()
    .frame(width: 360)
}
