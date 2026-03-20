import SwiftUI

/// Details section showing operation type, property type, UID, first seen date, and status.
struct ListingDetailsSection: View {
    let listing: Listing

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Details")
                .font(.headline)

            detailRow("Operation", value: listing.operationType.rawValue.capitalized)
            detailRow("Property Type", value: listing.propertyType.displayName)
            detailRow("Listing UID", value: String(listing.listingUid.prefix(8)) + "...")
            detailRow("First Seen", value: PriceFormatter.formatDateTime(listing.firstSeenAt))
            detailRow("Status", value: listing.listingStatus.rawValue.capitalized)
        }
    }

    private func detailRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline)
        }
    }
}
