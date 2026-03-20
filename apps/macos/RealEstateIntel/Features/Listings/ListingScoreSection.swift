import SwiftUI

/// Score analysis section showing overall score, breakdown bars, and keyword analysis.
struct ListingScoreSection: View {
    let listing: Listing
    let explanation: ScoreExplanation?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Text("Score Analysis")
                    .font(.headline)
                Spacer()
                ScoreIndicator(score: listing.currentScore, size: .large)
            }

            Text(Theme.scoreLabel(for: listing.currentScore))
                .font(.subheadline.bold())
                .foregroundStyle(Theme.scoreColor(for: listing.currentScore))

            if let explanation {
                scoreBreakdown(explanation)
            }
        }
    }

    private func scoreBreakdown(_ exp: ScoreExplanation) -> some View {
        VStack(spacing: Theme.Spacing.sm) {
            scoreRow("District Price", value: exp.districtPriceScore)
            scoreRow("Undervaluation", value: exp.undervaluationScore)
            scoreRow("Keyword Signals", value: exp.keywordSignalScore)
            scoreRow("Time on Market", value: exp.timeOnMarketScore)
            scoreRow("Confidence", value: exp.confidenceScore)

            Divider()

            if !exp.matchedPositiveKeywords.isEmpty {
                HStack(alignment: .top) {
                    Text("Positive keywords:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(exp.matchedPositiveKeywords.joined(separator: ", "))
                        .font(.caption.bold())
                        .foregroundStyle(.green)
                }
            }

            if !exp.matchedNegativeKeywords.isEmpty {
                HStack(alignment: .top) {
                    Text("Negative keywords:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(exp.matchedNegativeKeywords.joined(separator: ", "))
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
                    Text(PriceFormatter.formatPerSqm(exp.districtBaselinePpsqmEur) + "/m\u{00B2}")
                        .font(.caption.monospacedDigit())
                }
                HStack {
                    Text("Discount to district")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(PriceFormatter.formatPercent(exp.discountToDistrictPct))
                        .font(.caption.monospacedDigit().bold())
                        .foregroundStyle(.green)
                }
                HStack {
                    Text("Discount to bucket")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(PriceFormatter.formatPercent(exp.discountToBucketPct))
                        .font(.caption.monospacedDigit().bold())
                        .foregroundStyle(.green)
                }
            }
        }
    }

    private func scoreRow(_ label: String, value: Double) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 120, alignment: .leading)
            ScoreBar(score: value)
        }
    }
}
