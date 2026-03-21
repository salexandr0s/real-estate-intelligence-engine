import SwiftUI

/// Inspector content showing listing detail or empty state.
struct ListingsInspectorContent: View {
    let listing: Listing?

    var body: some View {
        if let listing {
            ListingDetailView(listing: listing)
        } else {
            ContentUnavailableView {
                Label("Select a listing", systemImage: "building.2")
            } description: {
                Text("Click a row to view details")
            }
        }
    }
}
