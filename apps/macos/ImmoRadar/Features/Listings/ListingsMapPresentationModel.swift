import MapKit
import SwiftUI

@MainActor
protocol ListingsMapDataSource {
    var districtBoundaries: [DistrictBoundary] { get }
    var developments: [WienDevelopment] { get }

    func boundary(for districtNo: Int) -> DistrictBoundary?
    func loadPOIsIfNeeded() async
    func pois(in region: MKCoordinateRegion, categories: Set<POICategory>) -> [POI]
}

struct LiveListingsMapDataSource: ListingsMapDataSource {
    var districtBoundaries: [DistrictBoundary] {
        ViennaDistrictStore.boundaries
    }

    var developments: [WienDevelopment] {
        ViennaDevelopmentStore.allDevelopments
    }

    func boundary(for districtNo: Int) -> DistrictBoundary? {
        ViennaDistrictStore.boundary(for: districtNo)
    }

    func loadPOIsIfNeeded() async {
        await ViennaPOIStore.loadIfNeeded()
    }

    func pois(in region: MKCoordinateRegion, categories: Set<POICategory>) -> [POI] {
        ViennaPOIStore.inRegion(region, categories: categories)
    }
}

@MainActor @Observable
final class ListingsMapPresentationModel {
    static let viennaCenter = CLLocationCoordinate2D(latitude: 48.2082, longitude: 16.3738)
    static let defaultRegion = MKCoordinateRegion(
        center: viennaCenter,
        span: MKCoordinateSpan(latitudeDelta: 0.15, longitudeDelta: 0.15)
    )

    private static let zoomedInLatitudeThreshold = 0.04
    private static let maxAnnotations = 500
    private static let alwaysShowCategories: Set<POICategory> = [
        .ubahn, .hospital, .fireStation, .police,
    ]

    @ObservationIgnored
    private let dataSource: any ListingsMapDataSource

    var mapStyle: MapStyle = .standard
    var position: MapCameraPosition = .region(ListingsMapPresentationModel.defaultRegion)
    var districtBoundaries: [DistrictBoundary] = []
    var showDistrictBoundaries = true
    var activePOICategories: Set<POICategory> = []
    var visiblePOIs: [POI] = []
    var visibleRegion: MKCoordinateRegion?
    var showDevelopments = false
    var visibleDevelopments: [WienDevelopment] = []
    var showPOIPicker = false
    var mappableListings: [Listing] = []
    var listingClusters: [DistrictCluster] = []

    var showPOIs: Bool {
        !activePOICategories.isEmpty
    }

    var isZoomedIn: Bool {
        guard let region = visibleRegion else { return false }
        return region.span.latitudeDelta < Self.zoomedInLatitudeThreshold
    }

    init(dataSource: any ListingsMapDataSource = LiveListingsMapDataSource()) {
        self.dataSource = dataSource
    }

    func bootstrap(filteredListings: [Listing], selectedDistrict: Int?) async {
        districtBoundaries = dataSource.districtBoundaries
        syncFilteredListings(filteredListings)
        await dataSource.loadPOIsIfNeeded()

        if let selectedDistrict {
            updateSelectedDistrict(selectedDistrict)
        }
    }

    func syncFilteredListings(_ listings: [Listing]) {
        let nextMappableListings = listings.filter { $0.coordinate != nil }
        mappableListings = nextMappableListings
        listingClusters = Self.computeClusters(for: nextMappableListings)
    }

    func updateVisibleRegion(_ region: MKCoordinateRegion) {
        visibleRegion = region
        refreshVisiblePOIs()
    }

    func refreshVisiblePOIs() {
        guard !activePOICategories.isEmpty else {
            visiblePOIs = []
            return
        }

        let region = visibleRegion ?? Self.defaultRegion
        let allInView = dataSource.pois(in: region, categories: activePOICategories)

        if allInView.count <= Self.maxAnnotations {
            visiblePOIs = allInView
            return
        }

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
            let gridDimension = max(1, Int(sqrt(Double(remaining))))
            let cellLatitude = region.span.latitudeDelta / Double(gridDimension)
            let cellLongitude = region.span.longitudeDelta / Double(gridDimension)

            var seenCells = Set<Int>()
            for poi in dense {
                let row = max(
                    0,
                    Int((poi.latitude - region.center.latitude + region.span.latitudeDelta / 2) / cellLatitude)
                )
                let column = max(
                    0,
                    Int((poi.longitude - region.center.longitude + region.span.longitudeDelta / 2) / cellLongitude)
                )
                let cellKey = row * 10_000 + column
                if seenCells.insert(cellKey).inserted {
                    kept.append(poi)
                    if kept.count >= Self.maxAnnotations {
                        break
                    }
                }
            }
        }

        visiblePOIs = kept
    }

    func setShowsDevelopments(_ isShown: Bool) {
        showDevelopments = isShown
        visibleDevelopments = isShown ? dataSource.developments : []
    }

    func fitToListings() {
        guard let region = Self.fittedRegion(for: mappableListings.compactMap(\.coordinate)) else { return }
        position = .region(region)
    }

    func focus(on coordinate: CLLocationCoordinate2D?) {
        guard let coordinate else { return }
        position = .region(
            MKCoordinateRegion(
                center: coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
            )
        )
    }

    func updateSelectedDistrict(_ districtNo: Int?) {
        if let districtNo, let boundary = dataSource.boundary(for: districtNo) {
            position = .region(boundary.boundingBox)
        } else if districtNo == nil {
            position = .region(Self.defaultRegion)
        }
    }

    private static func computeClusters(for listings: [Listing]) -> [DistrictCluster] {
        let listingsByDistrict = Dictionary(grouping: listings.filter { $0.districtNo != nil }) { $0.districtNo! }

        return listingsByDistrict.compactMap { districtNo, entries in
            let coordinates = entries.compactMap(\.coordinate)
            guard !coordinates.isEmpty else { return nil }

            let averageLatitude = coordinates.map(\.latitude).reduce(0, +) / Double(coordinates.count)
            let averageLongitude = coordinates.map(\.longitude).reduce(0, +) / Double(coordinates.count)
            let scoredListings = entries.compactMap(\.currentScore)
            let averageScore = scoredListings.isEmpty
                ? 0
                : scoredListings.reduce(0, +) / Double(scoredListings.count)

            return DistrictCluster(
                districtNo: districtNo,
                districtName: entries.first?.districtName,
                count: entries.count,
                center: CLLocationCoordinate2D(latitude: averageLatitude, longitude: averageLongitude),
                avgScore: averageScore
            )
        }
        .sorted { $0.districtNo < $1.districtNo }
    }

    private static func fittedRegion(for coordinates: [CLLocationCoordinate2D]) -> MKCoordinateRegion? {
        guard !coordinates.isEmpty else { return nil }

        let latitudes = coordinates.map(\.latitude)
        let longitudes = coordinates.map(\.longitude)

        guard let minimumLatitude = latitudes.min(),
              let maximumLatitude = latitudes.max(),
              let minimumLongitude = longitudes.min(),
              let maximumLongitude = longitudes.max() else {
            return nil
        }

        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: (minimumLatitude + maximumLatitude) / 2,
                longitude: (minimumLongitude + maximumLongitude) / 2
            ),
            span: MKCoordinateSpan(
                latitudeDelta: max((maximumLatitude - minimumLatitude) * 1.3, 0.01),
                longitudeDelta: max((maximumLongitude - minimumLongitude) * 1.3, 0.01)
            )
        )
    }
}
