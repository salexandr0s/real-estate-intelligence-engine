import SwiftUI

/// Simple bullet list for analysis assumptions.
struct AnalysisAssumptionsList: View {
    let items: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text("Assumptions")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fontWeight(.medium)

            ForEach(items, id: \.self) { item in
                Text("• \(item)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}
