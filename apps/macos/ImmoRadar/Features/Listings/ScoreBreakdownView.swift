import SwiftUI

/// Breakdown of score components with keyword tags and baseline stats.
struct ScoreBreakdownView: View {
    let explanation: ScoreExplanation

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            ScoreRow(label: "District Price", value: explanation.districtPriceScore)
            ScoreRow(label: "Undervaluation", value: explanation.undervaluationScore)
            ScoreRow(label: "Keywords", value: explanation.keywordSignalScore)
            ScoreRow(label: "Time on Market", value: explanation.timeOnMarketScore)
            ScoreRow(label: "Confidence", value: explanation.confidenceScore)
            if let locationScore = explanation.locationScore {
                ScoreRow(label: "Location", value: locationScore)
            }

            Divider()

            // Keywords as flow-wrapped tags
            if !explanation.matchedPositiveKeywords.isEmpty {
                keywordRow(label: "Positive", keywords: explanation.matchedPositiveKeywords, color: .green)
            }
            if !explanation.matchedNegativeKeywords.isEmpty {
                keywordRow(label: "Negative", keywords: explanation.matchedNegativeKeywords, color: .red)
            }

            // Baseline stats — 2 rows side by side
            Grid(alignment: .leading, horizontalSpacing: Theme.Spacing.lg, verticalSpacing: Theme.Spacing.xs) {
                GridRow {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text("District baseline")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        baselineValue(explanation.districtBaselinePpsqmEur)
                    }
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text("Discount to district")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(explanation.discountToDistrictPct.map(PriceFormatter.formatPercent) ?? "—")
                            .font(.caption.monospacedDigit().bold())
                            .foregroundStyle(.green)
                    }
                }
                GridRow {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text("Bucket baseline")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        baselineValue(explanation.bucketBaselinePpsqmEur)
                    }
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text("Discount to bucket")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(explanation.discountToBucketPct.map(PriceFormatter.formatPercent) ?? "—")
                            .font(.caption.monospacedDigit().bold())
                            .foregroundStyle(.green)
                    }
                }
            }
        }
    }

    /// The baseline price per m², or a plain note when no baseline covers the listing yet.
    @ViewBuilder
    private func baselineValue(_ ppsqmEur: Double?) -> some View {
        if let ppsqmEur {
            Text(PriceFormatter.formatPerSqm(ppsqmEur) + "/m\u{00B2}")
                .font(.caption.monospacedDigit())
        } else {
            Text("No baseline yet")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func keywordRow(label: String, keywords: [String], color: Color) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text("\(label) keywords")
                .font(.caption)
                .foregroundStyle(.secondary)
            FlowLayout(spacing: Theme.Spacing.xs) {
                ForEach(keywords, id: \.self) { keyword in
                    Text(keyword)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(color.opacity(0.1), in: Capsule())
                        .foregroundStyle(color)
                }
            }
        }
    }
}

