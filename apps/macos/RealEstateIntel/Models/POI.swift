import CoreLocation
import SwiftUI

/// A point of interest near a listing.
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
    case ubahn
    case tram
    case bus
    case taxi
    case park
    case school
    case police
    case fireStation = "fire_station"
    case supermarket
    case hospital
    case doctor

    var displayName: String {
        switch self {
        case .ubahn: "U-Bahn"
        case .tram: "Tram"
        case .bus: "Bus"
        case .taxi: "Taxi"
        case .park: "Parks"
        case .school: "Education"
        case .police: "Police"
        case .fireStation: "Fire Stations"
        case .supermarket: "Supermarkets"
        case .hospital: "Hospitals"
        case .doctor: "Doctors"
        }
    }

    var systemImage: String {
        switch self {
        case .ubahn: "tram.fill"
        case .tram: "cablecar.fill"
        case .bus: "bus.fill"
        case .taxi: "car.fill"
        case .park: "leaf.fill"
        case .school: "book.fill"
        case .police: "shield.fill"
        case .fireStation: "flame.fill"
        case .supermarket: "cart.fill"
        case .hospital: "cross.case.fill"
        case .doctor: "stethoscope"
        }
    }

    var tintColor: Color {
        switch self {
        case .ubahn: .blue
        case .tram: .cyan
        case .bus: .indigo
        case .taxi: .yellow
        case .park: .green
        case .school: .orange
        case .police: .gray
        case .fireStation: .red
        case .supermarket: .mint
        case .hospital: .pink
        case .doctor: .purple
        }
    }
}

/// Logical grouping for the POI picker UI.
enum POICategoryGroup: CaseIterable {
    case transit
    case safety
    case dailyLife
    case other

    var displayName: String {
        switch self {
        case .transit: "Transit"
        case .safety: "Safety"
        case .dailyLife: "Daily Life"
        case .other: "Other"
        }
    }

    var categories: [POICategory] {
        switch self {
        case .transit: [.ubahn, .tram, .bus, .taxi]
        case .safety: [.police, .fireStation]
        case .dailyLife: [.supermarket, .hospital, .doctor]
        case .other: [.park, .school]
        }
    }
}
