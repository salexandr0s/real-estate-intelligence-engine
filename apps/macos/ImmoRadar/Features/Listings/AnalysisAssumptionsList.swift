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
                HStack(spacing: Theme.Spacing.xs) {
                    Circle()
                        .fill(Color.secondary.opacity(0.4))
                        .frame(width: 6, height: 6)
                    Text(item)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(Theme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.06))
        .clipShape(.rect(cornerRadius: Theme.Radius.md))
    }
}
