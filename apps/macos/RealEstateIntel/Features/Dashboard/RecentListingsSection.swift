import SwiftUI

/// Recent high-score listings card with empty state handling.
struct RecentListingsSection: View {
    let listings: [Listing]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Label("Recent High-Score Listings", systemImage: "star.fill")
                    .font(.headline)
                Spacer()
                Text("\(listings.count) listings")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if listings.isEmpty {
                ContentUnavailableView {
                    Label("No high-score listings yet", systemImage: "building.2")
                } description: {
                    Text("Listings with score 60+ will appear here")
                }
            } else {
                VStack(spacing: 0) {
                    ForEach(listings) { listing in
                        DashboardListingRow(listing: listing)
                        if listing.id != listings.last?.id {
                            Divider()
                                .padding(.leading, 52)
                        }
                    }
                }
            }
        }
        .cardStyle()
        .frame(maxWidth: .infinity)
    }
}
