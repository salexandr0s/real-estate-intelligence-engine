import SwiftUI

/// Grid of summary statistic cards.
struct SummaryGridView: View {
    let cards: [DashboardViewModel.SummaryCard]

    var body: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: Theme.Spacing.lg),
                GridItem(.flexible(), spacing: Theme.Spacing.lg),
                GridItem(.flexible(), spacing: Theme.Spacing.lg),
                GridItem(.flexible(), spacing: Theme.Spacing.lg),
            ],
            spacing: Theme.Spacing.lg
        ) {
            ForEach(cards) { card in
                SummaryCardView(card: card)
            }
        }
    }
}
