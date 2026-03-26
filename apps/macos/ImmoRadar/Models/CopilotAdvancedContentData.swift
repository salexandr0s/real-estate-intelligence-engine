import CoreLocation
import Foundation

struct ListingComparisonData: Codable {
    let listings: [CopilotListing]
    let sections: [ListingComparisonSection]
    let callouts: [ComparisonCallout]
}

struct ListingComparisonSection: Codable, Identifiable {
    let title: String
    let metrics: [ListingComparisonMetric]

    var id: String { title }
}

struct ListingComparisonMetric: Codable, Identifiable {
    let label: String
    let values: [ListingComparisonValue]

    var id: String { label }
}

struct ListingComparisonValue: Codable, Identifiable {
    let listingId: Int
    let value: String?
    let emphasis: Emphasis?

    var id: Int { listingId }

    enum Emphasis: String, Codable {
        case best
        case weakest
        case neutral
    }
}

struct ComparisonCallout: Codable, Identifiable {
    let label: String
    let detail: String
    let listingId: Int?
    let tone: Tone

    var id: String { "\(label)-\(detail)" }

    enum Tone: String, Codable {
        case positive
        case neutral
        case caution
    }
}

struct CopilotCoordinate: Codable, Hashable {
    let latitude: Double
    let longitude: Double

    var locationCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

struct ProximitySummaryData: Codable {
    let listingId: Int
    let listingTitle: String
    let status: Status
    let dataSource: DataSource?
    let summary: String
    let listingCoordinate: CopilotCoordinate?
    let nearest: [ProximityNearestItem]
    let counts: [ProximityCountItem]

    enum Status: String, Codable {
        case ok
        case missingCoordinates = "missing_coordinates"
        case noPois = "no_pois"
    }

    enum DataSource: String, Codable {
        case cache
        case live
    }
}

struct ProximityNearestItem: Codable, Identifiable {
    let category: POICategory
    let label: String
    let name: String
    let distanceM: Int
    let walkMinutes: Int
    let rank: Int
    let coordinate: CopilotCoordinate?

    var id: String { "\(category.rawValue)-\(rank)" }
}

struct ProximityCountItem: Codable, Identifiable {
    let category: POICategory
    let label: String
    let withinMeters: Int
    let count: Int

    var id: String { "\(category.rawValue)-\(withinMeters)" }
}

struct CrossSourceComparisonData: Codable {
    let subjectListingId: Int
    let clusterId: Int
    let priceSpreadPct: Double?
    let summary: String
    let members: [CrossSourceComparisonMember]
}

struct CrossSourceComparisonMember: Codable, Identifiable {
    let listingId: Int
    let sourceCode: String
    let sourceName: String
    let title: String
    let listPriceEur: Double?
    let pricePerSqmEur: Double?
    let currentScore: Double?
    let canonicalUrl: String
    let firstSeenAt: String
    let isSubject: Bool

    var id: Int { listingId }
}
