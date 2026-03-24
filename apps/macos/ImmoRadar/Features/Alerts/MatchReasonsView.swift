import SwiftUI

/// Displays alert match reasons: keywords, district match, and threshold badges.
struct MatchReasonsView: View {
    let reasons: AlertMatchReasons

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Match Reasons")
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)

            if let keywords = reasons.matchedKeywords, !keywords.isEmpty {
                HStack(spacing: Theme.Spacing.xs) {
                    Text("Keywords:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    FlowLayout(spacing: Theme.Spacing.xs) {
                        ForEach(keywords, id: \.self) { keyword in
                            Text(keyword)
                                .font(.caption2)
                                .padding(.horizontal, Theme.Spacing.sm)
                                .padding(.vertical, Theme.Spacing.xxs)
                                .background(Color.accentColor.opacity(0.12))
                                .clipShape(Capsule())
                        }
                    }
                }
            }

            if reasons.districtMatch == true {
                HStack(spacing: Theme.Spacing.xs) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.caption)
                    Text("District match")
                        .font(.caption)
                }
            }

            if let thresholds = reasons.thresholdsMet {
                HStack(spacing: Theme.Spacing.sm) {
                    if thresholds.price == true {
                        ThresholdBadge(label: "Price")
                    }
                    if thresholds.area == true {
                        ThresholdBadge(label: "Area")
                    }
                    if thresholds.rooms == true {
                        ThresholdBadge(label: "Rooms")
                    }
                    if thresholds.score == true {
                        ThresholdBadge(label: "Score")
                    }
                }
            }
        }
    }
}
