import MapKit
import SwiftUI

/// Full map view showing all filtered listings as pins, replacing the table when in map mode.
struct ListingsMapView: View {
    @Bindable var viewModel: ListingsViewModel

    /// Vienna center — default camera position.
    private static let viennaCenter = CLLocationCoordinate2D(latitude: 48.2082, longitude: 16.3738)

    @State private var mapStyle: MapStyle = .standard
    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: viennaCenter,
            span: MKCoordinateSpan(latitudeDelta: 0.15, longitudeDelta: 0.15)
        )
    )

    private var mappableListings: [Listing] {
        viewModel.filteredListings.filter { $0.coordinate != nil }
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topTrailing) {
                Map(position: $position, selection: $viewModel.selectedListingID) {
                    ForEach(mappableListings) { listing in
                        Annotation(
                            listing.title,
                            coordinate: listing.coordinate!,
                            anchor: .bottom
                        ) {
                            ListingAnnotation(
                                listing: listing,
                                isSelected: listing.id == viewModel.selectedListingID
                            )
                            .onTapGesture {
                                viewModel.selectedListingID = listing.id
                            }
                        }
                        .tag(listing.id)
                        .annotationTitles(.hidden)
                    }
                }
                .mapStyle(mapStyle)

                mapControls
            }

            statusBar
        }
        .onChange(of: viewModel.mapFocusTrigger) {
            if let coord = viewModel.focusedMapCoordinate {
                withAnimation(.easeInOut(duration: 0.5)) {
                    position = .region(MKCoordinateRegion(
                        center: coord,
                        span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
                    ))
                }
                viewModel.focusedMapCoordinate = nil
            }
        }
    }

    // MARK: - Map Controls Overlay

    private var mapControls: some View {
        VStack(spacing: Theme.Spacing.xs) {
            mapStyleMenu

            Button {
                fitToListings()
            } label: {
                Image(systemName: "arrow.up.left.and.down.right.magnifyingglass")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help("Fit map to all visible listings")
        }
        .padding(Theme.Spacing.sm)
    }

    private var mapStyleMenu: some View {
        Menu {
            Button("Standard") { mapStyle = .standard }
            Button("Satellite") { mapStyle = .imagery }
            Button("Hybrid") { mapStyle = .hybrid }
        } label: {
            Image(systemName: "map")
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.bordered)
        .controlSize(.small)
        .frame(width: 32)
        .help("Change map style")
    }

    // MARK: - Status Bar

    private var statusBar: some View {
        HStack {
            let total = viewModel.filteredListings.count
            let mapped = mappableListings.count
            Text("\(mapped) of \(total) listings on map")
                .font(.caption)
                .foregroundStyle(.secondary)

            if mapped < total {
                Text("(\(total - mapped) without coordinates)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer()
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.xs)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    // MARK: - Helpers

    private func fitToListings() {
        let coords = mappableListings.compactMap(\.coordinate)
        guard !coords.isEmpty else { return }

        let lats = coords.map(\.latitude)
        let lons = coords.map(\.longitude)
        let center = CLLocationCoordinate2D(
            latitude: (lats.min()! + lats.max()!) / 2,
            longitude: (lons.min()! + lons.max()!) / 2
        )
        let span = MKCoordinateSpan(
            latitudeDelta: max((lats.max()! - lats.min()!) * 1.3, 0.01),
            longitudeDelta: max((lons.max()! - lons.min()!) * 1.3, 0.01)
        )

        withAnimation(.easeInOut(duration: 0.5)) {
            position = .region(MKCoordinateRegion(center: center, span: span))
        }
    }
}

#Preview {
    ListingsMapView(viewModel: ListingsViewModel())
        .frame(width: 800, height: 600)
}
