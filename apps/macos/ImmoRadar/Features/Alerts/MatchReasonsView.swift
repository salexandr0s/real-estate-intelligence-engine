import SwiftUI

/// Compact chips describing why an alert matched.
struct AlertMatchReasonChips: View {
    let reasons: AlertMatchReasons

    var body: some View {
        FlowLayout(spacing: Theme.Spacing.xs) {
            if reasons.districtMatch == true {
                badge(label: "District match", color: .green, icon: "checkmark.circle.fill")
            }

            ForEach(reasons.matchedKeywords ?? [], id: \.self) { keyword in
                badge(label: keyword, color: .accentColor, icon: "text.magnifyingglass")
            }

            if reasons.thresholdsMet?.price == true {
                ThresholdBadge(label: "Price")
            }
            if reasons.thresholdsMet?.area == true {
                ThresholdBadge(label: "Area")
            }
            if reasons.thresholdsMet?.rooms == true {
                ThresholdBadge(label: "Rooms")
            }
            if reasons.thresholdsMet?.score == true {
                ThresholdBadge(label: "Score")
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func badge(label: String, color: Color, icon: String) -> some View {
        Label(label, systemImage: icon)
            .font(.caption2)
            .foregroundStyle(color)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.xxs)
            .background(color.opacity(0.12), in: Capsule())
    }
}

/// Displays alert match reasons with a section title for inspector contexts.
struct MatchReasonsView: View {
    let reasons: AlertMatchReasons

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Match Reasons")
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)

            AlertMatchReasonChips(reasons: reasons)
        }
    }
}
