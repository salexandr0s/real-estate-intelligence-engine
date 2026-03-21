import SwiftUI

/// Details section showing operation type, property type, UID, first seen date, and status.
struct ListingDetailsSection: View {
    let listing: Listing

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Details")
                .font(.headline)

            DetailRow(label: "Operation", value: listing.operationType.rawValue.capitalized)
            DetailRow(label: "Property Type", value: listing.propertyType.displayName)
            DetailRow(label: "Listing UID", value: String(listing.listingUid.prefix(8)) + "...")
            DetailRow(label: "First Seen", value: PriceFormatter.formatDateTime(listing.firstSeenAt))
            DetailRow(label: "Status", value: listing.listingStatus.rawValue.capitalized)
        }
    }
}
