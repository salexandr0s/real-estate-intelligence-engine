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
                HStack(spacing: Theme.Spacing.xs) {
                    Circle()
                        .fill(Color.orange.opacity(0.6))
                        .frame(width: 6, height: 6)
                    Text(item)
                        .font(.caption)
                }
            }
        }
        .padding(Theme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.06))
        .clipShape(.rect(cornerRadius: Theme.Radius.md))
    }
}
