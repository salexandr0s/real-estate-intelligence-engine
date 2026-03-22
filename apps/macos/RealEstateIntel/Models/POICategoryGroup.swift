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
