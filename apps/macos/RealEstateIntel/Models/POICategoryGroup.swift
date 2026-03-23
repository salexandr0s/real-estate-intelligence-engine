/// Logical grouping for the POI picker UI.
enum POICategoryGroup: CaseIterable {
    case transit
    case emergencyServices
    case dailyLife
    case other

    var displayName: String {
        switch self {
        case .transit: "Transit"
        case .emergencyServices: "Emergency Services"
        case .dailyLife: "Daily Life"
        case .other: "Other"
        }
    }

    var categories: [POICategory] {
        switch self {
        case .transit: [.ubahn, .tram, .bus, .taxi]
        case .emergencyServices: [.police, .fireStation]
        case .dailyLife: [.supermarket, .hospital, .doctor]
        case .other: [.park, .school]
        }
    }
}
