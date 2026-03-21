import SwiftUI

/// Placeholder view shown when no geolocation data is available.
struct MapPlaceholder: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Map")
                .font(.headline)

            ContentUnavailableView {
                Label("No location data", systemImage: "map")
            } description: {
                Text("Map view will appear here when geolocation data is available.")
            }
        }
    }
}
