import SwiftUI

/// Adaptive grid of enhanced summary statistic cards.
struct SummaryGridView: View {
    let cards: [DashboardViewModel.EnhancedSummaryCard]

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 180), spacing: Theme.Spacing.lg)],
            spacing: Theme.Spacing.lg
        ) {
            ForEach(cards) { card in
                SummaryCardView(card: card)
            }
        }
    }
}
