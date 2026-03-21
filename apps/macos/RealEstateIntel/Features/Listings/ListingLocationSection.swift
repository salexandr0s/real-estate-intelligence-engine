import SwiftUI

/// Location section showing city, district, and postal code.
struct ListingLocationSection: View {
    let listing: Listing

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Location")
                .font(.headline)

            detailRow("City", value: listing.city)
            if let districtNo = listing.districtNo {
                detailRow("District", value: "\(districtNo). \(listing.districtName ?? "")")
            }
            if let postalCode = listing.postalCode {
                detailRow("Postal Code", value: postalCode)
            }
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
