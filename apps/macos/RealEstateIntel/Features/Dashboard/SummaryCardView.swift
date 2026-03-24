import SwiftUI

/// Compact summary metric — icon, value, label, and optional delta in a tight card.
struct SummaryCardView: View {
    let card: DashboardViewModel.EnhancedSummaryCard

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: card.icon)
                .font(.body)
                .foregroundStyle(card.color)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 0) {
                Text(card.value)
                    .font(.title2.bold())
                    .fontDesign(.rounded)
                    .contentTransition(.numericText())

                HStack(spacing: Theme.Spacing.xs) {
                    Text(card.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let delta = card.delta {
                        Text(delta.value)
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(delta.isPositive ? .green : .red)
                    }
                }
            }

            Spacer(minLength: 0)

            SparklineView(data: card.sparklineData, color: card.color)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Theme.cardBackground)
        .clipShape(.rect(cornerRadius: Theme.Radius.md))
        .shadow(color: .black.opacity(0.06), radius: 2, y: 1)
    }
}
