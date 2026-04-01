import MapKit
import SwiftUI

/// Map section in the listing inspector showing a single listing's location.
struct ListingMapView: View {
    let listing: Listing
    var onExpandToFullMap: (() -> Void)?

    @State private var mapStyle: MapStyle = .standard
    @State private var position: MapCameraPosition = .automatic

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Text("Map")
                    .font(.headline)
                Spacer()
                if listing.coordinate != nil {
                    mapStyleMenu
                    Button {
                        onExpandToFullMap?()
                    } label: {
                        Label("Expand", systemImage: "arrow.up.left.and.arrow.down.right")
                            .labelStyle(.iconOnly)
                    }
                    .buttonStyle(.borderless)
                    .help("Show in full map view")
                }
            }

            if let coordinate = listing.coordinate {
                Map(position: $position) {
                    if listing.hasExactLocation {
                        Marker(listing.title, coordinate: coordinate)
                            .tint(Theme.scoreColor(for: listing.currentScore ?? 0))
                    } else {
                        MapCircle(center: coordinate, radius: 200)
                            .foregroundStyle(Theme.scoreColor(for: listing.currentScore ?? 0).opacity(0.15))
                            .stroke(Theme.scoreColor(for: listing.currentScore ?? 0), lineWidth: 1.5)
                        Annotation(listing.title, coordinate: coordinate) {
                            Circle()
                                .fill(Theme.scoreColor(for: listing.currentScore ?? 0).opacity(0.5))
                                .frame(width: 8, height: 8)
                        }
                    }
                }
                .mapStyle(mapStyle)
                .frame(height: 180)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
                .task(id: listing.id) {
                    if let coord = listing.coordinate {
                        position = .region(MKCoordinateRegion(
                            center: coord,
                            span: MKCoordinateSpan(latitudeDelta: 0.008, longitudeDelta: 0.008)
                        ))
                    }
                }

                if !listing.hasExactLocation {
                    Text("Approximate location (\(listing.geocodePrecision ?? "unknown") precision)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                ContentUnavailableView {
                    Label("No location data", systemImage: "map")
                } description: {
                    Text("Coordinates are not available for this listing.")
                }
                .frame(height: 120)
            }
        }
    }

    private var mapStyleMenu: some View {
        Menu {
            Button("Standard") { mapStyle = .standard }
            Button("Satellite") { mapStyle = .imagery }
            Button("Hybrid") { mapStyle = .hybrid }
        } label: {
            Label("Map Style", systemImage: "map")
                .labelStyle(.iconOnly)
        }
        .menuStyle(.borderlessButton)
        .frame(width: 24)
        .help("Change map style")
    }
}

#Preview("With exact location") {
    ListingMapView(listing: Listing.samples[0])
        .frame(width: 360)
        .padding()
}

#Preview("No location") {
    ListingMapView(listing: Listing.samples[7])
        .frame(width: 360)
        .padding()
}
