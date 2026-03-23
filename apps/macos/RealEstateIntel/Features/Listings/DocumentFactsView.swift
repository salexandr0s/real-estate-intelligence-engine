import SwiftUI

/// Displays extracted facts for a document, with loading and empty states.
struct DocumentFactsView: View {
    let facts: [DocumentFact]?
    let isLoading: Bool

    var body: some View {
        if isLoading {
            ProgressView()
                .controlSize(.small)
                .padding(.vertical, Theme.Spacing.xs)
        } else if let facts {
            if facts.isEmpty {
                Text("No facts extracted")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, Theme.Spacing.xs)
            } else {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    ForEach(facts) { fact in
                        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                                Text(fact.factType.replacing("_", with: " ").capitalized)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(fact.factValue)
                                    .font(.caption)
                            }
                            Spacer()
                            StatusBadge(
                                label: fact.confidence.capitalized,
                                color: Theme.confidenceColor(for: fact.confidence)
                            )
                        }
                    }
                }
                .padding(.top, Theme.Spacing.xs)
            }
        }
    }
}
