import SwiftUI

/// Single summary card for the dashboard grid.
struct SummaryCardView: View {
    let card: DashboardViewModel.SummaryCard

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Image(systemName: card.icon)
                    .font(.title3)
                    .foregroundStyle(card.color)
                Spacer()
            }
            Text(card.value)
                .font(.largeTitle.bold())
                .fontDesign(.rounded)
                .foregroundStyle(.primary)
            Text(card.title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .cardStyle()
    }
}
