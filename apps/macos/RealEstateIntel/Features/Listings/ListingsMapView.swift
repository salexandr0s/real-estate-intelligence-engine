import MapKit
import SwiftUI

/// Full map view showing all filtered listings as pins, replacing the table when in map mode.
/// Supports district boundary overlays, filter-aware zoom, and draw-to-search.
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
    @State private var districtBoundaries: [DistrictBoundary] = []
    @State private var showDistrictBoundaries: Bool = true
    @State private var showPOIs: Bool = false
    @State private var activePOICategories: Set<POICategory> = Set(POICategory.allCases)
    @State private var visiblePOIs: [POI] = []
    @State private var showDevelopments: Bool = false
    @State private var visibleDevelopments: [WienDevelopment] = []

    private var mappableListings: [Listing] {
        viewModel.filteredListings.filter { $0.coordinate != nil }
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topTrailing) {
                MapReader { proxy in
                    Map(position: $position, selection: $viewModel.selectedListingID) {
                        // District boundary overlays (render before pins so pins are on top)
                        if showDistrictBoundaries {
                            ForEach(districtBoundaries) { district in
                                ForEach(district.polygons.indices, id: \.self) { i in
                                    MapPolygon(coordinates: district.polygons[i])
                                        .foregroundStyle(districtFill(for: district))
                                        .stroke(districtStroke(for: district), lineWidth: districtStrokeWidth(for: district))
                                }
                            }
                        }

                        // Active selection region
                        if let region = viewModel.selectionRegion {
                            MapPolygon(coordinates: regionToCorners(region))
                                .foregroundStyle(Color.accentColor.opacity(0.1))
                                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                        }

                        // Listing pins
                        ForEach(mappableListings) { listing in
                            Annotation(
                                listing.title,
                                coordinate: listing.coordinate ?? Self.viennaCenter,
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

                        // POI pins
                        if showPOIs {
                            ForEach(visiblePOIs) { poi in
                                Annotation(poi.name, coordinate: poi.coordinate, anchor: .center) {
                                    POIAnnotation(poi: poi)
                                }
                                .annotationTitles(.hidden)
                            }
                        }

                        // Wien development project markers
                        if showDevelopments {
                            ForEach(visibleDevelopments) { dev in
                                if let coord = dev.coordinate {
                                    Annotation(dev.name, coordinate: coord, anchor: .center) {
                                        DevelopmentAnnotation(development: dev)
                                    }
                                    .annotationTitles(.automatic)
                                }
                            }
                        }
                    }
                    .mapStyle(mapStyle)
                    .overlay {
                        if viewModel.isDrawingSelection {
                            MapSelectionOverlay(proxy: proxy) { region in
                                if let region {
                                    viewModel.selectionRegion = region
                                }
                                viewModel.isDrawingSelection = false
                            }
                        }
                    }
                }

                mapControls
            }

            statusBar
        }
        .task {
            districtBoundaries = ViennaDistrictStore.boundaries
            // If a district filter is already active, zoom to it
            if let districtNo = viewModel.selectedDistrict,
               let boundary = ViennaDistrictStore.boundary(for: districtNo) {
                position = .region(boundary.boundingBox)
            }
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
        .onChange(of: viewModel.selectedDistrict) { _, newDistrict in
            if let districtNo = newDistrict,
               let boundary = districtBoundaries.first(where: { $0.id == districtNo }) {
                withAnimation(.easeInOut(duration: 0.6)) {
                    position = .region(boundary.boundingBox)
                }
            } else if newDistrict == nil {
                withAnimation(.easeInOut(duration: 0.5)) {
                    position = .region(MKCoordinateRegion(
                        center: Self.viennaCenter,
                        span: MKCoordinateSpan(latitudeDelta: 0.15, longitudeDelta: 0.15)
                    ))
                }
            }
        }
    }

    // MARK: - District Styling

    private func districtFill(for district: DistrictBoundary) -> Color {
        if viewModel.selectedDistrict == district.id {
            return Color.accentColor.opacity(0.08)
        }
        return .clear
    }

    private func districtStroke(for district: DistrictBoundary) -> Color {
        if viewModel.selectedDistrict == district.id {
            return .accentColor
        }
        return .secondary.opacity(0.4)
    }

    private func districtStrokeWidth(for district: DistrictBoundary) -> CGFloat {
        viewModel.selectedDistrict == district.id ? 2.5 : 0.8
    }

    // MARK: - Map Controls Overlay

    private var mapControls: some View {
        VStack(spacing: Theme.Spacing.xs) {
            mapStyleMenu

            Button {
                showDistrictBoundaries.toggle()
            } label: {
                Image(systemName: showDistrictBoundaries ? "square.on.square.dashed" : "square.dashed")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help(showDistrictBoundaries ? "Hide district boundaries" : "Show district boundaries")

            Button {
                fitToListings()
            } label: {
                Image(systemName: "arrow.up.left.and.down.right.magnifyingglass")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help("Fit map to all visible listings")

            Divider()
                .frame(width: 20)

            poiLayerMenu

            Button {
                showDevelopments.toggle()
                if showDevelopments {
                    visibleDevelopments = ViennaDevelopmentStore.allDevelopments
                } else {
                    visibleDevelopments = []
                }
            } label: {
                Image(systemName: showDevelopments ? "building.2.fill" : "building.2")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .tint(showDevelopments ? .purple : nil)
            .help(showDevelopments ? "Hide developments" : "Show Wien developments")

            Divider()
                .frame(width: 20)

            Button {
                viewModel.isDrawingSelection.toggle()
            } label: {
                Image(systemName: viewModel.isDrawingSelection ? "pencil.slash" : "pencil.and.outline")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .tint(viewModel.isDrawingSelection ? .accentColor : nil)
            .help(viewModel.isDrawingSelection ? "Cancel drawing" : "Draw to search")
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

    private var poiLayerMenu: some View {
        Menu {
            Button {
                showPOIs.toggle()
                updateVisiblePOIs()
            } label: {
                Label(showPOIs ? "Hide All POIs" : "Show All POIs",
                      systemImage: showPOIs ? "mappin.slash" : "mappin.circle")
            }

            if showPOIs {
                Divider()
                ForEach(POICategory.allCases, id: \.self) { category in
                    Button {
                        if activePOICategories.contains(category) {
                            activePOICategories.remove(category)
                        } else {
                            activePOICategories.insert(category)
                        }
                        updateVisiblePOIs()
                    } label: {
                        HStack {
                            Image(systemName: category.systemImage)
                            Text(category.displayName)
                            if activePOICategories.contains(category) {
                                Spacer()
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
        } label: {
            Image(systemName: showPOIs ? "mappin.circle.fill" : "mappin.circle")
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.bordered)
        .controlSize(.small)
        .frame(width: 32)
        .tint(showPOIs ? .blue : nil)
        .help("Points of interest")
    }

    private func updateVisiblePOIs() {
        guard showPOIs else {
            visiblePOIs = []
            return
        }
        // Show POIs within the current visible area
        // Use a default Vienna-wide region as fallback
        let region = currentRegion
        visiblePOIs = ViennaPOIStore.inRegion(region, categories: activePOICategories)
    }

    /// Approximate current visible region for viewport culling.
    private var currentRegion: MKCoordinateRegion {
        MKCoordinateRegion(
            center: Self.viennaCenter,
            span: MKCoordinateSpan(latitudeDelta: 0.20, longitudeDelta: 0.20)
        )
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

            if viewModel.selectionRegion != nil {
                HStack(spacing: Theme.Spacing.xs) {
                    Image(systemName: "selection.pin.in.out")
                        .foregroundStyle(Color.accentColor)
                    Text("Area selected")
                        .font(.caption)
                        .foregroundStyle(Color.accentColor)
                    Button {
                        viewModel.selectionRegion = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .controlSize(.mini)
                }
            }
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

    private func regionToCorners(_ region: MKCoordinateRegion) -> [CLLocationCoordinate2D] {
        let halfLat = region.span.latitudeDelta / 2
        let halfLon = region.span.longitudeDelta / 2
        let c = region.center
        return [
            CLLocationCoordinate2D(latitude: c.latitude - halfLat, longitude: c.longitude - halfLon),
            CLLocationCoordinate2D(latitude: c.latitude + halfLat, longitude: c.longitude - halfLon),
            CLLocationCoordinate2D(latitude: c.latitude + halfLat, longitude: c.longitude + halfLon),
            CLLocationCoordinate2D(latitude: c.latitude - halfLat, longitude: c.longitude + halfLon),
        ]
    }
}

#Preview {
    ListingsMapView(viewModel: ListingsViewModel())
        .frame(width: 800, height: 600)
}
