import MapKit
import SwiftUI

/// Full map view showing all filtered listings as pins, replacing the table when in map mode.
/// Supports district boundary overlays, filter-aware zoom, and draw-to-search.
struct ListingsMapView: View {
    @Bindable var viewModel: ListingsViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var presentationModel = ListingsMapPresentationModel()

    var body: some View {
        VStack(spacing: 0) {
            mapViewport(model: presentationModel)

            MapStatusBar(
                filteredCount: viewModel.filteredListings.count,
                mappableCount: presentationModel.mappableListings.count,
                hasSelectionRegion: viewModel.selectionRegion != nil,
                onClearSelection: { viewModel.selectionRegion = nil }
            )
        }
        .task {
            await presentationModel.bootstrap(
                filteredListings: viewModel.filteredListings,
                selectedDistrict: viewModel.selectedDistrict
            )
        }
        .onChange(of: viewModel.filteredListings) { _, newListings in
            presentationModel.syncFilteredListings(newListings)
        }
        .onChange(of: viewModel.mapFocusTrigger) {
            guard let coordinate = viewModel.focusedMapCoordinate else { return }
            withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.5)) {
                presentationModel.focus(on: coordinate)
            }
            viewModel.focusedMapCoordinate = nil
        }
        .onChange(of: viewModel.selectedDistrict) { _, newDistrict in
            let animation = newDistrict == nil
                ? Animation.easeInOut(duration: 0.5)
                : Animation.easeInOut(duration: 0.6)
            withAdaptiveAnimation(reduceMotion, animation) {
                presentationModel.updateSelectedDistrict(newDistrict)
            }
        }
    }

    private func mapViewport(model: ListingsMapPresentationModel) -> some View {
        @Bindable var mapModel = model

        return ZStack {
            MapReader { proxy in
                mapView(model: model, proxy: proxy)
            }

            VStack {
                HStack {
                    MapStyleMenu(mapStyle: $mapModel.mapStyle)
                    Spacer()
                }
                Spacer()
            }
            .padding(12)

            VStack {
                HStack {
                    Spacer()
                    mapControls(model: model)
                }
                Spacer()
            }
            .padding(12)
        }
    }

    private func mapView(model: ListingsMapPresentationModel, proxy: MapProxy) -> some View {
        @Bindable var mapModel = model

        return Map(
            position: $mapModel.position,
            bounds: MapCameraBounds(
                centerCoordinateBounds: ViennaBoundaryStore.cameraBounds,
                minimumDistance: 500,
                maximumDistance: 40_000
            ),
            selection: $viewModel.selectedListingID
        ) {
            mapContent(mapModel: model)
        }
        .mapStyle(model.mapStyle)
        .onMapCameraChange(frequency: .onEnd) { context in
            model.updateVisibleRegion(context.region)
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

    @MapContentBuilder
    private func mapContent(mapModel: ListingsMapPresentationModel) -> some MapContent {
        MapPolygon(ViennaBoundaryStore.maskPolygon)
            .foregroundStyle(Color.black.opacity(0.40))

        if mapModel.showDistrictBoundaries {
            districtBoundaryContent(boundaries: mapModel.districtBoundaries)
        }

        if let region = viewModel.selectionRegion {
            MapPolygon(coordinates: regionToCorners(region))
                .foregroundStyle(Color.accentColor.opacity(0.1))
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
        }

        if mapModel.isZoomedIn {
            listingAnnotationContent(listings: mapModel.mappableListings)
        } else {
            clusterAnnotationContent(clusters: mapModel.listingClusters)
        }

        if mapModel.showPOIs {
            poiAnnotationContent(pois: mapModel.visiblePOIs)
        }

        if mapModel.showDevelopments {
            developmentAnnotationContent(developments: mapModel.visibleDevelopments)
        }
    }

    @MapContentBuilder
    private func districtBoundaryContent(boundaries: [DistrictBoundary]) -> some MapContent {
        ForEach(boundaries) { district in
            ForEach(district.polygons.indices, id: \.self) { index in
                MapPolygon(coordinates: district.polygons[index])
                    .foregroundStyle(districtFill(for: district))
                    .stroke(
                        districtStroke(for: district),
                        lineWidth: districtStrokeWidth(for: district)
                    )
            }
        }
    }

    @MapContentBuilder
    private func listingAnnotationContent(listings: [Listing]) -> some MapContent {
        ForEach(listings) { listing in
            Annotation(
                listing.title,
                coordinate: listing.coordinate ?? ListingsMapPresentationModel.viennaCenter,
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
    }

    @MapContentBuilder
    private func clusterAnnotationContent(clusters: [DistrictCluster]) -> some MapContent {
        ForEach(clusters, id: \.districtNo) { cluster in
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

    @MapContentBuilder
    private func poiAnnotationContent(pois: [POI]) -> some MapContent {
        ForEach(pois) { poi in
            Annotation(poi.name, coordinate: poi.coordinate, anchor: .center) {
                POIAnnotation(poi: poi)
            }
            .annotationTitles(.hidden)
        }
    }

    @MapContentBuilder
    private func developmentAnnotationContent(developments: [WienDevelopment]) -> some MapContent {
        ForEach(developments) { development in
            if let coordinate = development.coordinate {
                Annotation(development.name, coordinate: coordinate, anchor: .center) {
                    DevelopmentAnnotation(development: development)
                }
                .annotationTitles(.hidden)
            }
        }
    }

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

    private func mapControls(model: ListingsMapPresentationModel) -> some View {
        @Bindable var mapModel = model

        return VStack(spacing: 8) {
            controlGroup {
                mapIconButton(
                    "Fit All Listings",
                    icon: "arrow.up.left.and.down.right.magnifyingglass",
                    isActive: false
                ) {
                    withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.5)) {
                        model.fitToListings()
                    }
                }

                mapIconButton(
                    "Draw Selection",
                    icon: viewModel.isDrawingSelection ? "pencil.slash" : "pencil.and.outline",
                    isActive: viewModel.isDrawingSelection
                ) {
                    viewModel.isDrawingSelection.toggle()
                }
            }

            controlGroup {
                mapIconButton(
                    "District Boundaries",
                    icon: model.showDistrictBoundaries ? "square.on.square.dashed" : "square.dashed",
                    isActive: model.showDistrictBoundaries
                ) {
                    model.showDistrictBoundaries.toggle()
                }

                mapIconButton(
                    "Development Projects",
                    icon: model.showDevelopments ? "building.2.fill" : "building.2",
                    isActive: model.showDevelopments,
                    tint: .purple
                ) {
                    model.setShowsDevelopments(!model.showDevelopments)
                }

                POILayerMenu(
                    activePOICategories: $mapModel.activePOICategories,
                    showPOIPicker: $mapModel.showPOIPicker,
                    onCategoryChanged: { model.refreshVisiblePOIs() }
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
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(isActive ? tint : .primary)
            .frame(width: 36, height: 36)
            .contentShape(Rectangle())
            .buttonStyle(.plain)
            .help(tooltip)
    }

    private func regionToCorners(_ region: MKCoordinateRegion) -> [CLLocationCoordinate2D] {
        let halfLatitude = region.span.latitudeDelta / 2
        let halfLongitude = region.span.longitudeDelta / 2
        let center = region.center
        return [
            CLLocationCoordinate2D(
                latitude: center.latitude - halfLatitude,
                longitude: center.longitude - halfLongitude
            ),
            CLLocationCoordinate2D(
                latitude: center.latitude + halfLatitude,
                longitude: center.longitude - halfLongitude
            ),
            CLLocationCoordinate2D(
                latitude: center.latitude + halfLatitude,
                longitude: center.longitude + halfLongitude
            ),
            CLLocationCoordinate2D(
                latitude: center.latitude - halfLatitude,
                longitude: center.longitude + halfLongitude
            ),
        ]
    }
}

#Preview {
    ListingsMapView(viewModel: ListingsViewModel())
        .frame(width: 800, height: 600)
}
