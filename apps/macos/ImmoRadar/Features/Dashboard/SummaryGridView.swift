import SwiftUI

/// Adaptive grid of enhanced summary statistic cards.
@available(*, deprecated, message: "Replaced by SummaryStripView")
struct SummaryGridView: View {
    let cards: [DashboardViewModel.SummaryCard]
    var onCardNavigate: ((String) -> Void)?

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 180), spacing: Theme.Spacing.lg)],
            spacing: Theme.Spacing.lg
        ) {
            ForEach(cards) { card in
                SummaryCardView(
                    card: card,
                    onNavigate: onCardNavigate.map { callback in { callback(card.id) } }
                )
            }
        }
    }
}
