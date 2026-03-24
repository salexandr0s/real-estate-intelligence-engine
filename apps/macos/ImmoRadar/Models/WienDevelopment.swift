import CoreLocation
import MapKit
import os
import SwiftUI

/// A Vienna city development project.
struct WienDevelopment: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let status: String
    let description: String?
    let category: String?
    let duration: String?
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

    var statusColor: Color {
        switch status {
        case "genehmigt/laufend": .purple
        case "abgeschlossen": .mint
        case "beantragt": .indigo
        default: .gray
        }
    }

    /// Description with HTML tags stripped for display.
    var plainDescription: String? {
        guard let html = description else { return nil }
        let stripped = html
            .replacingOccurrences(of: "<br\\s*/?>", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacing("&amp;", with: "&")
            .replacing("&lt;", with: "<")
            .replacing("&gt;", with: ">")
            .replacing("&quot;", with: "\"")
            .replacing("&#39;", with: "'")
            .replacing("&nbsp;", with: " ")
            .replacingOccurrences(of: "&#\\d+;", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !stripped.isEmpty else { return nil }
        if stripped.count > 200 {
            let end = stripped.index(stripped.startIndex, offsetBy: 200)
            return String(stripped[..<end]) + "…"
        }
        return stripped
    }
}

/// Loads and caches Wien development projects from the bundled GeoJSON.
enum ViennaDevelopmentStore {

    static let allDevelopments: [WienDevelopment] = loadDevelopments()

    private static func loadDevelopments() -> [WienDevelopment] {
        guard let url = Bundle.main.url(forResource: "vienna-developments", withExtension: "geojson"),
              let data = try? Data(contentsOf: url) else {
            Log.data.error("Failed to load vienna-developments.geojson")
            return []
        }

        let decoder = MKGeoJSONDecoder()
        guard let geoObjects = try? decoder.decode(data) else {
            Log.data.error("Failed to decode GeoJSON")
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
                duration: props["duration"] as? String,
                latitude: point.coordinate.latitude,
                longitude: point.coordinate.longitude,
                url: props["url"] as? String
            ))
        }

        Log.data.info("Loaded \(results.count) developments")
        return results
    }
}
