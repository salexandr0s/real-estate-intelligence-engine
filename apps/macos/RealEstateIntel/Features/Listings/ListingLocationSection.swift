import SwiftUI

/// Location section showing city, district, and postal code.
struct ListingLocationSection: View {
    let listing: Listing

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Location")
                .font(.headline)

            DetailRow(label: "City", value: listing.city)
            if let districtNo = listing.districtNo {
                DetailRow(label: "District", value: "\(districtNo). \(listing.districtName ?? "")")
            }
            if let postalCode = listing.postalCode {
                DetailRow(label: "Postal Code", value: postalCode)
            }
        }
    }
}
