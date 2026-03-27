import SwiftUI

/// Grid of stat cards with labels, values, and trend indicators.
struct MarketStatsBlock: View {
    let stats: [StatItem]

    private let columns = [
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: Theme.Spacing.sm) {
            ForEach(stats) { stat in
                StatCard(stat: stat)
            }
        }
    }
}

// MARK: - Single Stat Card

private struct StatCard: View {
    let stat: StatItem

    var body: some View {
        VStack(spacing: Theme.Spacing.xs) {
            Text(stat.label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            HStack(spacing: Theme.Spacing.xs) {
                Text(stat.value)
                    .font(.title3.monospacedDigit().bold())
                    .lineLimit(1)

                if let trend = stat.trend {
                    trendIcon(trend)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .copilotArtifactInset(padding: Theme.Spacing.md)
    }

    private func trendIcon(_ trend: StatItem.Trend) -> some View {
        Image(systemName: trend == .up ? "arrow.up.right" : trend == .down ? "arrow.down.right" : "arrow.right")
            .font(.caption.bold())
            .foregroundStyle(trend == .up ? .green : trend == .down ? .red : .secondary)
    }
}
