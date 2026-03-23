import SwiftUI

/// Card showing building facts — year built, typology, unit count, source confidence.
struct AnalysisBuildingContextCard: View {
    let building: AnalysisBuildingContext

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("Building")
                    .font(.subheadline)
                    .fontWeight(.medium)
                Spacer()
                StatusBadge(
                    label: building.matchConfidence.capitalized,
                    color: Theme.confidenceColor(for: building.matchConfidence)
                )
            }

            let rows: [(String, String)] = [
                building.yearBuilt.map { ("Year Built", "\($0)") },
                building.typology.map { ("Typology", $0) },
                building.unitCount.map { ("Units", "\($0)") },
                ("Source", building.source),
            ].compactMap { $0 }

            ForEach(rows, id: \.0) { row in
                DetailRow(label: row.0, value: row.1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }
}
