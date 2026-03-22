import CoreLocation
import MapKit

/// A parsed district boundary with polygon coordinates and precomputed bounding box.
struct DistrictBoundary: Identifiable {
    let id: Int
    let name: String
    let polygons: [[CLLocationCoordinate2D]]
    let boundingBox: MKCoordinateRegion
}

/// Loads and caches Vienna's 23 district boundaries from the bundled GeoJSON resource.
enum ViennaDistrictStore {

    /// All 23 district boundaries, parsed once on first access.
    static let boundaries: [DistrictBoundary] = loadBoundaries()

    /// Lookup a single district boundary by number.
    static func boundary(for districtNo: Int) -> DistrictBoundary? {
        boundaries.first { $0.id == districtNo }
    }

    // MARK: - Parsing

    private static func loadBoundaries() -> [DistrictBoundary] {
        guard let url = Bundle.main.url(forResource: "vienna-districts", withExtension: "geojson"),
              let data = try? Data(contentsOf: url) else {
            NSLog("[ViennaDistrictStore] Failed to load vienna-districts.geojson")
            return []
        }

        let decoder = MKGeoJSONDecoder()
        guard let geoObjects = try? decoder.decode(data) else {
            NSLog("[ViennaDistrictStore] Failed to decode GeoJSON")
            return []
        }

        var results: [DistrictBoundary] = []

        for object in geoObjects {
            guard let feature = object as? MKGeoJSONFeature,
                  let propsData = feature.properties,
                  let props = try? JSONSerialization.jsonObject(with: propsData) as? [String: Any],
                  let districtNo = props["BEZNR"] as? Int,
                  let name = props["NAMEG"] as? String else {
                continue
            }

            var allPolygons: [[CLLocationCoordinate2D]] = []

            for geometry in feature.geometry {
                if let polygon = geometry as? MKPolygon {
                    allPolygons.append(extractCoordinates(from: polygon))
                } else if let multiPolygon = geometry as? MKMultiPolygon {
                    for polygon in multiPolygon.polygons {
                        allPolygons.append(extractCoordinates(from: polygon))
                    }
                }
            }

            guard !allPolygons.isEmpty else { continue }

            let bbox = computeBoundingBox(for: allPolygons)
            results.append(DistrictBoundary(
                id: districtNo,
                name: name,
                polygons: allPolygons,
                boundingBox: bbox
            ))
        }

        NSLog("[ViennaDistrictStore] Loaded %d district boundaries", results.count)
        return results.sorted { $0.id < $1.id }
    }

    private static func extractCoordinates(from polygon: MKPolygon) -> [CLLocationCoordinate2D] {
        let count = polygon.pointCount
        var coords = [CLLocationCoordinate2D](repeating: CLLocationCoordinate2D(), count: count)
        polygon.getCoordinates(&coords, range: NSRange(location: 0, length: count))
        return coords
    }

    private static func computeBoundingBox(for polygons: [[CLLocationCoordinate2D]]) -> MKCoordinateRegion {
        let allCoords = polygons.flatMap { $0 }
        guard !allCoords.isEmpty else {
            return MKCoordinateRegion()
        }

        let lats = allCoords.map(\.latitude)
        let lons = allCoords.map(\.longitude)
        let minLat = lats.min()!
        let maxLat = lats.max()!
        let minLon = lons.min()!
        let maxLon = lons.max()!

        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLon + maxLon) / 2
        )
        let span = MKCoordinateSpan(
            latitudeDelta: (maxLat - minLat) * 1.2,
            longitudeDelta: (maxLon - minLon) * 1.2
        )

        return MKCoordinateRegion(center: center, span: span)
    }
}
