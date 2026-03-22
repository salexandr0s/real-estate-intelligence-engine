import CoreLocation
import MapKit

/// A Vienna city development project.
struct WienDevelopment: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let status: String
    let description: String?
    let category: String?
    let latitude: Double?
    let longitude: Double?
    let url: String?

    var coordinate: CLLocationCoordinate2D? {
        guard let lat = latitude, let lon = longitude else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    var statusDisplay: String {
        switch status {
        case "genehmigt/laufend": "In Progress"
        case "abgeschlossen": "Completed"
        case "beantragt": "Planned"
        default: status.capitalized
        }
    }
}

/// Loads and caches Wien development projects from the bundled GeoJSON.
enum ViennaDevelopmentStore {

    static let allDevelopments: [WienDevelopment] = loadDevelopments()

    private static func loadDevelopments() -> [WienDevelopment] {
        guard let url = Bundle.main.url(forResource: "vienna-developments", withExtension: "geojson"),
              let data = try? Data(contentsOf: url) else {
            NSLog("[ViennaDevelopmentStore] Failed to load vienna-developments.geojson")
            return []
        }

        let decoder = MKGeoJSONDecoder()
        guard let geoObjects = try? decoder.decode(data) else {
            NSLog("[ViennaDevelopmentStore] Failed to decode GeoJSON")
            return []
        }

        var results: [WienDevelopment] = []

        for object in geoObjects {
            guard let feature = object as? MKGeoJSONFeature,
                  let propsData = feature.properties,
                  let props = try? JSONSerialization.jsonObject(with: propsData) as? [String: Any],
                  let id = props["id"] as? String,
                  let name = props["name"] as? String else {
                continue
            }

            guard let point = feature.geometry.first as? MKPointAnnotation else { continue }

            results.append(WienDevelopment(
                id: id,
                name: name,
                status: props["status"] as? String ?? "unknown",
                description: props["description"] as? String,
                category: props["category"] as? String,
                latitude: point.coordinate.latitude,
                longitude: point.coordinate.longitude,
                url: props["url"] as? String
            ))
        }

        NSLog("[ViennaDevelopmentStore] Loaded %d developments", results.count)
        return results
    }
}
