import SwiftUI

/// Displays the analysis confidence level with optional degradation reasons.
struct AnalysisConfidenceBadge: View {
    let confidence: AnalysisConfidence

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            StatusBadge(
                label: "Confidence: \(confidence.level.capitalized)",
                color: Theme.confidenceColor(for: confidence.level)
            )

            if !confidence.degradationReasons.isEmpty {
                Text(confidence.degradationReasons.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }
}
