import MapKit
import SwiftUI

/// Full map view showing all filtered listings as pins, replacing the table when in map mode.
/// Supports district boundary overlays, filter-aware zoom, and draw-to-search.
struct ListingsMapView: View {
    @Bindable var viewModel: ListingsViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
    @State private var activePOICategories: Set<POICategory> = []
    @State private var visiblePOIs: [POI] = []
    @State private var visibleRegion: MKCoordinateRegion?
    @State private var showDevelopments: Bool = false
    @State private var visibleDevelopments: [WienDevelopment] = []
    @State private var showPOIPicker: Bool = false
    @State private var listingClusters: [DistrictCluster] = []

    private var showPOIs: Bool { !activePOICategories.isEmpty }

    private var mappableListings: [Listing] {
        viewModel.filteredListings.filter { $0.coordinate != nil }
    }

    /// Zoom threshold: show individual pins when the span is small enough to see a single district.
    private var isZoomedIn: Bool {
        guard let region = visibleRegion else { return false }
        return region.span.latitudeDelta < 0.04
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                MapReader { proxy in
                    Map(
                        position: $position,
                        bounds: MapCameraBounds(
                            centerCoordinateBounds: ViennaBoundaryStore.cameraBounds,
                            minimumDistance: 500,
                            maximumDistance: 40_000
                        ),
                        selection: $viewModel.selectedListingID
                    ) {
                        // Boundary mask — darkens everything outside Vienna
                        MapPolygon(ViennaBoundaryStore.maskPolygon)
                            .foregroundStyle(Color.black.opacity(0.40))
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

                        // Listing pins — show clusters when zoomed out, individual pins when zoomed in
                        if isZoomedIn {
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
                                }
                                .tag(listing.id)
                                .annotationTitles(.hidden)
                            }
                        } else {
                            ForEach(listingClusters, id: \.districtNo) { cluster in
                                Annotation(
                                    "\(cluster.count) listings",
                                    coordinate: cluster.center,
                                    anchor: .center
                                ) {
                                    ListingClusterBubble(
                                        count: cluster.count,
                                        avgScore: cluster.avgScore,
                                        districtName: cluster.districtName
                                    )
                                }
                                .annotationTitles(.hidden)
                            }
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
                                    .annotationTitles(.hidden)
                                }
                            }
                        }
                    }
                    .mapStyle(mapStyle)
                    .onMapCameraChange(frequency: .onEnd) { context in
                        visibleRegion = context.region
                        refreshVisiblePOIs()
                    }
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

                // Map style — top left
                VStack {
                    HStack {
                        MapStyleMenu(mapStyle: $mapStyle)
                        Spacer()
                    }
                    Spacer()
                }
                .padding(12)

                // Layer & tool controls — top right
                VStack {
                    HStack {
                        Spacer()
                        mapControls
                    }
                    Spacer()
                }
                .padding(12)
            }

            MapStatusBar(
                filteredCount: viewModel.filteredListings.count,
                mappableCount: mappableListings.count,
                hasSelectionRegion: viewModel.selectionRegion != nil,
                onClearSelection: { viewModel.selectionRegion = nil }
            )
        }
        .task {
            districtBoundaries = ViennaDistrictStore.boundaries
            await ViennaPOIStore.loadIfNeeded()
            recomputeClusters()
            // If a district filter is already active, zoom to it
            if let districtNo = viewModel.selectedDistrict,
               let boundary = ViennaDistrictStore.boundary(for: districtNo) {
                position = .region(boundary.boundingBox)
            }
        }
        .onChange(of: viewModel.filteredListings.map(\.id)) { _, _ in
            recomputeClusters()
        }
        .onChange(of: viewModel.mapFocusTrigger) {
            if let coord = viewModel.focusedMapCoordinate {
                withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.5)) {
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
                withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.6)) {
                    position = .region(boundary.boundingBox)
                }
            } else if newDistrict == nil {
                withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.5)) {
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
        VStack(spacing: 8) {
            // Tools
            controlGroup {
                mapIconButton(
                    "Fit All Listings",
                    icon: "arrow.up.left.and.down.right.magnifyingglass",
                    isActive: false
                ) {
                    fitToListings()
                }

                mapIconButton(
                    "Draw Selection",
                    icon: viewModel.isDrawingSelection ? "pencil.slash" : "pencil.and.outline",
                    isActive: viewModel.isDrawingSelection
                ) {
                    viewModel.isDrawingSelection.toggle()
                }
            }

            // Layers
            controlGroup {
                mapIconButton(
                    "District Boundaries",
                    icon: showDistrictBoundaries ? "square.on.square.dashed" : "square.dashed",
                    isActive: showDistrictBoundaries
                ) {
                    showDistrictBoundaries.toggle()
                }

                mapIconButton(
                    "Development Projects",
                    icon: showDevelopments ? "building.2.fill" : "building.2",
                    isActive: showDevelopments,
                    tint: .purple
                ) {
                    showDevelopments.toggle()
                    if showDevelopments {
                        visibleDevelopments = ViennaDevelopmentStore.allDevelopments
                    } else {
                        visibleDevelopments = []
                    }
                }

                POILayerMenu(
                    activePOICategories: $activePOICategories,
                    showPOIPicker: $showPOIPicker,
                    onCategoryChanged: { refreshVisiblePOIs() }
                )
            }
        }
    }

    private func controlGroup<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .adaptiveMaterial(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.12), radius: 4, y: 1)
    }

    private func mapIconButton(
        _ tooltip: String,
        icon: String,
        isActive: Bool,
        tint: Color = .accentColor,
        action: @escaping () -> Void
    ) -> some View {
        Button(tooltip, systemImage: icon, action: action)
            .labelStyle(.iconOnly)
            .font(.system(size: 16, weight: .medium)) // Fixed size: map control
            .foregroundStyle(isActive ? tint : .primary)
            .frame(width: 36, height: 36)
            .contentShape(Rectangle())
            .buttonStyle(.plain)
            .help(tooltip)
    }

    /// Maximum annotations to render simultaneously for smooth performance.
    private static let maxAnnotations = 500

    /// Categories that should never be thinned (low count, high value).
    private static let alwaysShowCategories: Set<POICategory> = [
        .ubahn, .hospital, .fireStation, .police,
    ]

    /// Recompute visible POIs based on actual viewport and active categories.
    /// Applies density limiting when annotation count would exceed the cap.
    private func refreshVisiblePOIs() {
        guard !activePOICategories.isEmpty else {
            visiblePOIs = []
            return
        }

        let region = visibleRegion ?? MKCoordinateRegion(
            center: Self.viennaCenter,
            span: MKCoordinateSpan(latitudeDelta: 0.15, longitudeDelta: 0.15)
        )

        let allInView = ViennaPOIStore.inRegion(region, categories: activePOICategories)

        if allInView.count <= Self.maxAnnotations {
            visiblePOIs = allInView
            return
        }

        // Density limiting: keep all high-value categories, thin dense ones
        var kept: [POI] = []
        var dense: [POI] = []

        for poi in allInView {
            if Self.alwaysShowCategories.contains(poi.category) {
                kept.append(poi)
            } else {
                dense.append(poi)
            }
        }

        let remaining = Self.maxAnnotations - kept.count
        if remaining > 0, !dense.isEmpty {
            // Spatial thinning: divide viewport into ~remaining cells,
            // keep at most one POI per cell for even spatial distribution.
            let gridDim = max(1, Int(sqrt(Double(remaining))))
            let cellLat = region.span.latitudeDelta / Double(gridDim)
            let cellLon = region.span.longitudeDelta / Double(gridDim)

            var seen = Set<Int>()
            for poi in dense {
                let row = max(0, Int((poi.latitude - region.center.latitude + region.span.latitudeDelta / 2) / cellLat))
                let col = max(0, Int((poi.longitude - region.center.longitude + region.span.longitudeDelta / 2) / cellLon))
                let key = row * 10_000 + col
                if seen.insert(key).inserted {
                    kept.append(poi)
                    if kept.count >= Self.maxAnnotations { break }
                }
            }
        }

        visiblePOIs = kept
    }

    // MARK: - Cluster Computation

    private func recomputeClusters() {
        let mappable = mappableListings
        let byDistrict = Dictionary(grouping: mappable.filter { $0.districtNo != nil }) { $0.districtNo! }
        listingClusters = byDistrict.map { districtNo, listings in
            let avgLat = listings.compactMap(\.latitude).reduce(0, +) / Double(listings.count)
            let avgLon = listings.compactMap(\.longitude).reduce(0, +) / Double(listings.count)
            let avgScore = listings.compactMap(\.currentScore).reduce(0, +) / max(1, Double(listings.compactMap(\.currentScore).count))
            return DistrictCluster(
                districtNo: districtNo,
                districtName: listings.first?.districtName,
                count: listings.count,
                center: CLLocationCoordinate2D(latitude: avgLat, longitude: avgLon),
                avgScore: avgScore
            )
        }
    }

    // MARK: - Helpers

    private func fitToListings() {
        let coords = mappableListings.compactMap(\.coordinate)
        guard !coords.isEmpty else { return }

        let lats = coords.map(\.latitude)
        let lons = coords.map(\.longitude)
        guard let minLat = lats.min(), let maxLat = lats.max(),
              let minLon = lons.min(), let maxLon = lons.max() else { return }
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLon + maxLon) / 2
        )
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * 1.3, 0.01),
            longitudeDelta: max((maxLon - minLon) * 1.3, 0.01)
        )

        withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.5)) {
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
