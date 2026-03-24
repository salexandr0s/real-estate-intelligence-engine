import SwiftUI

/// Placeholder view shown when no price history data is available.
struct PriceHistoryPlaceholder: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Price History")
                .font(.headline)

            ContentUnavailableView {
                Label("No price history", systemImage: "chart.line.uptrend.xyaxis")
            } description: {
                Text("Price history chart will appear here when the backend provides historical data.")
            }
        }
    }
}
