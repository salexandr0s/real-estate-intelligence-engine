import CoreLocation
import MapKit
// MARK: - Spatial Grid Index

/// Fixed-resolution grid index for fast spatial POI queries.
/// Vienna is divided into a grid of cells; each cell stores the POIs whose coordinates fall within it.
/// Region queries only scan the overlapping cells instead of all 16K+ POIs.
struct POIGrid {
    // Vienna bounding box (with small padding)
    static let latMin = 48.10
    static let latMax = 48.34
    static let lonMin = 16.17
    static let lonMax = 16.60

    let cellsLat = 100
    let cellsLon = 100
    let latStep: Double
    let lonStep: Double
    private let cells: [[POI]]
    let totalCount: Int

    init() {
        latStep = (Self.latMax - Self.latMin) / 100
        lonStep = (Self.lonMax - Self.lonMin) / 100
        cells = Array(repeating: [], count: 100 * 100)
        totalCount = 0
    }

    init(pois: [POI]) {
        latStep = (Self.latMax - Self.latMin) / 100
        lonStep = (Self.lonMax - Self.lonMin) / 100

        var grid = Array(repeating: [POI](), count: 100 * 100)
        var count = 0

        for poi in pois {
            let row = min(99, max(0, Int((poi.latitude - Self.latMin) / latStep)))
            let col = min(99, max(0, Int((poi.longitude - Self.lonMin) / lonStep)))
            grid[row * 100 + col].append(poi)
            count += 1
        }

        cells = grid
        totalCount = count
    }

    /// Return POIs within a map region, optionally filtered by categories.
    func inRegion(_ region: MKCoordinateRegion, categories: Set<POICategory>?) -> [POI] {
        let latLo = region.center.latitude - region.span.latitudeDelta / 2
        let latHi = region.center.latitude + region.span.latitudeDelta / 2
        let lonLo = region.center.longitude - region.span.longitudeDelta / 2
        let lonHi = region.center.longitude + region.span.longitudeDelta / 2

        let rowLo = max(0, Int((latLo - Self.latMin) / latStep))
        let rowHi = min(cellsLat - 1, Int((latHi - Self.latMin) / latStep))
        let colLo = max(0, Int((lonLo - Self.lonMin) / lonStep))
        let colHi = min(cellsLon - 1, Int((lonHi - Self.lonMin) / lonStep))

        var result: [POI] = []

        for row in rowLo...rowHi {
            for col in colLo...colHi {
                for poi in cells[row * 100 + col] {
                    if let cats = categories, !cats.contains(poi.category) { continue }
                    // Fine-grained bounds check for edge cells
                    if poi.latitude >= latLo, poi.latitude <= latHi,
                       poi.longitude >= lonLo, poi.longitude <= lonHi {
                        result.append(poi)
                    }
                }
            }
        }

        return result
    }

    /// Find POIs near a coordinate within a radius, sorted by distance.
    func nearby(
        coordinate: CLLocationCoordinate2D,
        radiusMeters: Double,
        categories: Set<POICategory>? = nil
    ) -> [(poi: POI, distanceM: Double)] {
        // Convert radius to approximate degrees for cell range
        let latDelta = radiusMeters / 111_320.0
        let lonDelta = radiusMeters / (111_320.0 * cos(coordinate.latitude * .pi / 180))

        let rowLo = max(0, Int((coordinate.latitude - latDelta - Self.latMin) / latStep))
        let rowHi = min(cellsLat - 1, Int((coordinate.latitude + latDelta - Self.latMin) / latStep))
        let colLo = max(0, Int((coordinate.longitude - lonDelta - Self.lonMin) / lonStep))
        let colHi = min(cellsLon - 1, Int((coordinate.longitude + lonDelta - Self.lonMin) / lonStep))

        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        var result: [(poi: POI, distanceM: Double)] = []

        for row in rowLo...rowHi {
            for col in colLo...colHi {
                for poi in cells[row * 100 + col] {
                    if let cats = categories, !cats.contains(poi.category) { continue }
                    let d = location.distance(from: CLLocation(latitude: poi.latitude, longitude: poi.longitude))
                    if d <= radiusMeters {
                        result.append((poi, d))
                    }
                }
            }
        }

        return result.sorted { $0.distanceM < $1.distanceM }
    }
}

// MARK: - ViennaPOIStore

/// Loads and caches Vienna POI data from the bundled GeoJSON resource with spatial indexing.
@MainActor
enum ViennaPOIStore {
    private(set) static var grid = POIGrid()
    private(set) static var isLoaded = false

    /// Call from a `.task` modifier to ensure POIs are loaded before use.
    static func loadIfNeeded() async {
        guard !isLoaded else { return }
        let pois = await Task.detached(priority: .userInitiated) {
            Self.parsePOIsOffMain()
        }.value
        grid = POIGrid(pois: pois)
        isLoaded = true
        NSLog("[ViennaPOIStore] POI grid built: %d POIs", grid.totalCount)
    }

    /// Parse GeoJSON off the main thread. This function is nonisolated.
    nonisolated private static func parsePOIsOffMain() -> [POI] {
        parsePOIsSync()
    }

    /// Find POIs within a map region.
    static func inRegion(_ region: MKCoordinateRegion, categories: Set<POICategory>?) -> [POI] {
        grid.inRegion(region, categories: categories)
    }

    /// Find POIs near a coordinate within a radius, sorted by distance.
    static func nearby(
        coordinate: CLLocationCoordinate2D,
        radiusMeters: Double = 500,
        categories: Set<POICategory>? = nil
    ) -> [(poi: POI, distanceM: Double)] {
        grid.nearby(coordinate: coordinate, radiusMeters: radiusMeters, categories: categories)
    }

    // MARK: - Parsing

    private nonisolated static func parsePOIsSync() -> [POI] {
        guard let url = Bundle.main.url(forResource: "vienna-pois", withExtension: "geojson"),
              let data = try? Data(contentsOf: url) else {
            return []
        }

        let decoder = MKGeoJSONDecoder()
        guard let geoObjects = try? decoder.decode(data) else {
            return []
        }

        var results: [POI] = []
        results.reserveCapacity(16_000)

        for object in geoObjects {
            guard let feature = object as? MKGeoJSONFeature,
                  let propsData = feature.properties,
                  let props = try? JSONSerialization.jsonObject(with: propsData) as? [String: Any],
                  let id = props["id"] as? String,
                  let name = props["name"] as? String,
                  let categoryStr = props["category"] as? String,
                  let category = POICategory(rawValue: categoryStr) else {
                continue
            }

            guard let pointGeometry = feature.geometry.first as? MKPointAnnotation else { continue }
            let coord = pointGeometry.coordinate

            results.append(POI(
                id: id,
                name: name,
                category: category,
                subcategory: props["subcategory"] as? String,
                latitude: coord.latitude,
                longitude: coord.longitude
            ))
        }

        return results
    }
}
