import SwiftUI

/// Score analysis section with overall indicator and collapsible breakdown.
struct ListingScoreSection: View {
    let listing: Listing
    let explanation: ScoreExplanation?

    @State private var showBreakdown: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            if let explanation {
                DisclosureGroup(isExpanded: $showBreakdown) {
                    ScoreBreakdownView(explanation: explanation)
                        .padding(.top, Theme.Spacing.sm)
                } label: {
                    Text("Score Breakdown")
                        .font(.headline)
                }
            }
        }
    }
}
