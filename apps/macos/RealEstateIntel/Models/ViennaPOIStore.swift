import CoreLocation
import MapKit

/// Loads and caches Vienna POI data from the bundled GeoJSON resource.
enum ViennaPOIStore {

    /// All POIs, parsed once on first access.
    static let allPOIs: [POI] = loadPOIs()

    /// Filter POIs by category.
    static func pois(for category: POICategory) -> [POI] {
        allPOIs.filter { $0.category == category }
    }

    /// Find POIs near a coordinate within a radius, sorted by distance.
    static func nearby(
        coordinate: CLLocationCoordinate2D,
        radiusMeters: Double = 500,
        categories: Set<POICategory>? = nil
    ) -> [(poi: POI, distanceM: Double)] {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)

        return allPOIs
            .compactMap { poi -> (poi: POI, distanceM: Double)? in
                if let cats = categories, !cats.contains(poi.category) { return nil }
                let poiLocation = CLLocation(latitude: poi.latitude, longitude: poi.longitude)
                let distance = location.distance(from: poiLocation)
                guard distance <= radiusMeters else { return nil }
                return (poi, distance)
            }
            .sorted { $0.distanceM < $1.distanceM }
    }

    /// Find POIs visible within a map region.
    static func inRegion(_ region: MKCoordinateRegion, categories: Set<POICategory>? = nil) -> [POI] {
        let latMin = region.center.latitude - region.span.latitudeDelta / 2
        let latMax = region.center.latitude + region.span.latitudeDelta / 2
        let lonMin = region.center.longitude - region.span.longitudeDelta / 2
        let lonMax = region.center.longitude + region.span.longitudeDelta / 2

        return allPOIs.filter { poi in
            if let cats = categories, !cats.contains(poi.category) { return false }
            return poi.latitude >= latMin && poi.latitude <= latMax
                && poi.longitude >= lonMin && poi.longitude <= lonMax
        }
    }

    // MARK: - Parsing

    private static func loadPOIs() -> [POI] {
        guard let url = Bundle.main.url(forResource: "vienna-pois", withExtension: "geojson"),
              let data = try? Data(contentsOf: url) else {
            NSLog("[ViennaPOIStore] Failed to load vienna-pois.geojson")
            return []
        }

        let decoder = MKGeoJSONDecoder()
        guard let geoObjects = try? decoder.decode(data) else {
            NSLog("[ViennaPOIStore] Failed to decode GeoJSON")
            return []
        }

        var results: [POI] = []

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

            // Extract coordinates from geometry
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

        NSLog("[ViennaPOIStore] Loaded %d POIs", results.count)
        return results
    }
}
