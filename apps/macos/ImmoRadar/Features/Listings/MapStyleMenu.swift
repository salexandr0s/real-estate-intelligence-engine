import MapKit
import SwiftUI

/// Map style picker button for the map overlay.
struct MapStyleMenu: View {
    @Binding var mapStyle: MapStyle

    var body: some View {
        Menu("Map Style", systemImage: "map") {
            Button("Standard") { mapStyle = .standard }
            Button("Satellite") { mapStyle = .imagery }
            Button("Hybrid") { mapStyle = .hybrid }
        }
        .labelStyle(.iconOnly)
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(.primary)
        .menuStyle(.borderlessButton)
        .frame(width: 36, height: 36)
        .adaptiveMaterial(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.12), radius: 4, y: 1)
        .help("Map Style")
    }
}
