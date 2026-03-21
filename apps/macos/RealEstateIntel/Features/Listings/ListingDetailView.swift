import SwiftUI

/// Detail view for a single listing, shown in the inspector pane.
struct ListingDetailView: View {
    let listing: Listing
    @State private var explanation: ScoreExplanation? = Listing.sampleExplanation

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                ListingHeaderSection(listing: listing)
                Divider()
                ListingScoreSection(listing: listing, explanation: explanation)
                Divider()
                ListingDetailsSection(listing: listing)
                Divider()
                ListingLocationSection(listing: listing)
                Divider()
                PriceHistoryPlaceholder()
                Divider()
                MapPlaceholder()
                Divider()
                ListingActionsSection(canonicalUrl: listing.canonicalUrl)
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}

#Preview {
    ListingDetailView(listing: Listing.samples[0])
        .frame(width: 380, height: 900)
}
