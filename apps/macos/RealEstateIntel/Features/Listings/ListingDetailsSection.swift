import SwiftUI

/// Property details and location in a 2-column grid layout.
struct ListingDetailsSection: View {
    let listing: Listing

    private var rows: [(label: String, value: String)] {
        var result: [(String, String)] = [
            ("Operation", listing.operationType.rawValue.capitalized),
            ("Property Type", listing.propertyType.displayName),
        ]

        result.append(("City", listing.city))

        if let districtNo = listing.districtNo {
            result.append(("District", "\(districtNo). \(listing.districtName ?? "")"))
        }
        if let postalCode = listing.postalCode {
            result.append(("Postal Code", postalCode))
        }

        result.append(("Status", listing.listingStatus.rawValue.capitalized))
        result.append(("First Seen", PriceFormatter.formatDateTime(listing.firstSeenAt)))
        result.append(("Listing UID", String(listing.listingUid.prefix(8)) + "..."))

        return result
    }

    var body: some View {
        InspectorGridSection(title: "Details", rows: rows)
    }
}
