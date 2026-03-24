import SwiftUI

/// Location section showing nearby POI metrics with full details.
/// Basic location fields (city, district, postal) are in ListingDetailsSection.
struct ListingLocationSection: View {
    let listing: Listing

    @State private var nearbyPOIs: [(poi: POI, distanceM: Double)] = []

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            if listing.coordinate != nil, !nearbyPOIs.isEmpty {
                Text("Nearby")
                    .font(.headline)

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
