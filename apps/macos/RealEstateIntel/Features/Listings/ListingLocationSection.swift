import SwiftUI

/// Location section showing city, district, postal code, and nearby POI metrics.
struct ListingLocationSection: View {
    let listing: Listing

    @State private var nearbyPOIs: [(poi: POI, distanceM: Double)] = []

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

            if listing.coordinate != nil, !nearbyPOIs.isEmpty {
                Divider()
                Text("Nearby")
                    .font(.subheadline)
                    .fontWeight(.semibold)

                ProximityMetricsView(nearbyPOIs: nearbyPOIs)
            }
        }
        .task(id: listing.id) {
            await ViennaPOIStore.loadIfNeeded()
            if let coord = listing.coordinate {
                nearbyPOIs = ViennaPOIStore.nearby(
                    coordinate: coord,
                    radiusMeters: 2000
                )
            } else {
                nearbyPOIs = []
            }
        }
    }
}
