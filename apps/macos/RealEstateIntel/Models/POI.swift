import CoreLocation
import SwiftUI

/// A point of interest near a listing (transit stop, park, school, police station).
struct POI: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let category: POICategory
    let subcategory: String?
    let latitude: Double
    let longitude: Double

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

/// POI category with display metadata.
enum POICategory: String, Codable, CaseIterable, Hashable {
    case transit
    case park
    case school
    case police

    var displayName: String {
        switch self {
        case .transit: "Transit"
        case .park: "Parks"
        case .school: "Education"
        case .police: "Police"
        }
    }

    var systemImage: String {
        switch self {
        case .transit: "tram.fill"
        case .park: "leaf.fill"
        case .school: "book.fill"
        case .police: "shield.fill"
        }
    }

    var tintColor: Color {
        switch self {
        case .transit: .blue
        case .park: .green
        case .school: .orange
        case .police: .gray
        }
    }
}
