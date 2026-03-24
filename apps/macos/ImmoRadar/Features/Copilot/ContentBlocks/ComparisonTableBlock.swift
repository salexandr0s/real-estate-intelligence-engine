import SwiftUI

/// Side-by-side comparison table of listings rendered in a Grid.
struct ComparisonTableBlock: View {
    let data: ComparisonTableData

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Comparison")
                .font(.subheadline.bold())

            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: Theme.Spacing.lg, verticalSpacing: Theme.Spacing.sm) {
                    // Header row
                    GridRow {
                        Text("")
                            .gridColumnAlignment(.leading)

                        ForEach(data.headers, id: \.self) { header in
                            Text(header)
                                .font(.caption.bold())
                                .lineLimit(2)
                                .frame(minWidth: 100)
                        }
                    }

                    Divider()
                        .gridCellUnsizedAxes(.horizontal)

                    // Data rows
                    ForEach(data.rows, id: \.label) { row in
                        GridRow {
                            Text(row.label)
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            ForEach(Array(row.values.enumerated()), id: \.offset) { _, value in
                                Text(value)
                                    .font(.caption.monospacedDigit())
                                    .frame(minWidth: 100, alignment: .leading)
                            }
                        }
                    }
                }
                .padding(Theme.Spacing.md)
            }
            .scrollIndicators(.hidden)
        }
        .padding(Theme.Spacing.md)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
        .shadow(radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
    }
}
