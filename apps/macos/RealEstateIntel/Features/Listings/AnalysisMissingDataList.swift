import SwiftUI

/// Simple bullet list for missing data items.
struct AnalysisMissingDataList: View {
    let items: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text("Missing Data")
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.orange)

            ForEach(items, id: \.self) { item in
                Text("• \(item)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
