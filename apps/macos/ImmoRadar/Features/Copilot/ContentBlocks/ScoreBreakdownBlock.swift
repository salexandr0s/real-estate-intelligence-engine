import SwiftUI

/// Renders a score breakdown with overall indicator and component bars.
struct ScoreBreakdownBlock: View {
    let data: ScoreBreakdownData

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            // Overall score
            HStack(spacing: Theme.Spacing.md) {
                ScoreIndicator(score: data.overall, size: .regular)

                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text("Score: \(Theme.scoreLabel(for: data.overall))")
                        .font(.subheadline.bold())

                    if let discount = data.discountToDistrictPct {
                        Text("\(discount, format: .number.precision(.fractionLength(1)))% vs district avg")
                            .font(.caption)
                            .foregroundStyle(discount < 0 ? .green : .secondary)
                    }
                }
            }

            // Component bars
            VStack(spacing: Theme.Spacing.sm) {
                ForEach(data.components, id: \.name) { component in
                    HStack(spacing: Theme.Spacing.sm) {
                        Text(component.name)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(width: 100, alignment: .trailing)

                        ScoreBar(score: component.score)
                    }
                }
            }

            // Keywords
            keywordsSection
        }
        .copilotArtifactCard(padding: Theme.Spacing.md, tone: .score)
    }

    @ViewBuilder
    private var keywordsSection: some View {
        let positive = data.positiveKeywords ?? []
        let negative = data.negativeKeywords ?? []

        if !positive.isEmpty || !negative.isEmpty {
            Divider()

            HStack(spacing: Theme.Spacing.lg) {
                if !positive.isEmpty {
                    keywordGroup(keywords: positive, color: .green, icon: "plus.circle.fill")
                }
                if !negative.isEmpty {
                    keywordGroup(keywords: negative, color: .red, icon: "minus.circle.fill")
                }
            }
        }
    }

    private func keywordGroup(keywords: [String], color: Color, icon: String) -> some View {
        HStack(spacing: Theme.Spacing.xs) {
            Image(systemName: icon)
                .font(.caption2)
                .foregroundStyle(color)

            Text(keywords.joined(separator: ", "))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
