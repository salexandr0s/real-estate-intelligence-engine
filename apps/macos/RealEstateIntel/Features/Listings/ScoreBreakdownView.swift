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
                        Text(PriceFormatter.formatPerSqm(explanation.districtBaselinePpsqmEur) + "/m\u{00B2}")
                            .font(.caption.monospacedDigit())
                    }
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text("Discount to district")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(PriceFormatter.formatPercent(explanation.discountToDistrictPct))
                            .font(.caption.monospacedDigit().bold())
                            .foregroundStyle(.green)
                    }
                }
                GridRow {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text("Bucket baseline")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(PriceFormatter.formatPerSqm(explanation.bucketBaselinePpsqmEur) + "/m\u{00B2}")
                            .font(.caption.monospacedDigit())
                    }
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text("Discount to bucket")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(PriceFormatter.formatPercent(explanation.discountToBucketPct))
                            .font(.caption.monospacedDigit().bold())
                            .foregroundStyle(.green)
                    }
                }
            }
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

/// Simple flow layout that wraps content to the next line.
struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }

    private struct LayoutResult {
        var positions: [CGPoint]
        var size: CGSize
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> LayoutResult {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            totalWidth = max(totalWidth, x - spacing)
        }

        return LayoutResult(
            positions: positions,
            size: CGSize(width: totalWidth, height: y + rowHeight)
        )
    }
}
