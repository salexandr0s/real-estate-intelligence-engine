import SwiftUI

/// Score analysis section showing overall score, breakdown bars, and keyword analysis.
struct ListingScoreSection: View {
    let listing: Listing
    let explanation: ScoreExplanation?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Text("Score Analysis")
                    .font(.headline)
                Spacer()
                ScoreIndicator(score: listing.currentScore ?? 0, size: .large)
            }

            Text(Theme.scoreLabel(for: listing.currentScore ?? 0))
                .font(.subheadline.bold())
                .foregroundStyle(Theme.scoreColor(for: listing.currentScore ?? 0))

            if let explanation {
                ScoreBreakdownView(explanation: explanation)
            }
        }
    }
}
