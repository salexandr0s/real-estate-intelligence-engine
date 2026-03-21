import SwiftUI

/// Breakdown of score components with keyword analysis and baseline stats.
struct ScoreBreakdownView: View {
    let explanation: ScoreExplanation

    var body: some View {
        VStack(spacing: Theme.Spacing.sm) {
            ScoreRow(label: "District Price", value: explanation.districtPriceScore)
            ScoreRow(label: "Undervaluation", value: explanation.undervaluationScore)
            ScoreRow(label: "Keyword Signals", value: explanation.keywordSignalScore)
            ScoreRow(label: "Time on Market", value: explanation.timeOnMarketScore)
            ScoreRow(label: "Confidence", value: explanation.confidenceScore)

            Divider()

            if !explanation.matchedPositiveKeywords.isEmpty {
                HStack(alignment: .top) {
                    Text("Positive keywords:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(explanation.matchedPositiveKeywords.joined(separator: ", "))
                        .font(.caption.bold())
                        .foregroundStyle(.green)
                }
            }

            if !explanation.matchedNegativeKeywords.isEmpty {
                HStack(alignment: .top) {
                    Text("Negative keywords:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(explanation.matchedNegativeKeywords.joined(separator: ", "))
                        .font(.caption.bold())
                        .foregroundStyle(.red)
                }
            }

            VStack(spacing: Theme.Spacing.xs) {
                HStack {
                    Text("District baseline")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(PriceFormatter.formatPerSqm(explanation.districtBaselinePpsqmEur) + "/m\u{00B2}")
                        .font(.caption.monospacedDigit())
                }
                HStack {
                    Text("Discount to district")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(PriceFormatter.formatPercent(explanation.discountToDistrictPct))
                        .font(.caption.monospacedDigit().bold())
                        .foregroundStyle(.green)
                }
                HStack {
                    Text("Discount to bucket")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(PriceFormatter.formatPercent(explanation.discountToBucketPct))
                        .font(.caption.monospacedDigit().bold())
                        .foregroundStyle(.green)
                }
            }
        }
    }
}
