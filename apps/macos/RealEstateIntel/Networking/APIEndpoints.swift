import Foundation

/// Type-safe API endpoint definitions.
/// All paths are relative to the base URL (default: http://localhost:8080).
enum APIEndpoint {

    // MARK: - Listings

    case listListings(query: ListingQuery)
    case getListing(id: Int)
    case getScoreExplanation(listingId: Int)
    case getListingHistory(listingId: Int)

    // MARK: - Filters

    case listFilters
    case createFilter(body: Data)
    case getFilter(id: Int)
    case updateFilter(id: Int, body: Data)
    case deleteFilter(id: Int)
    case testFilter(id: Int)

    // MARK: - Alerts

    case listAlerts(query: AlertQuery?)
    case updateAlert(id: Int, body: Data)
    case getUnreadCount

    // MARK: - Sources

    case listSources
    case updateSource(id: Int, body: Data)

    // MARK: - Path & Method

    var path: String {
        switch self {
        case .listListings: return "/v1/listings"
        case .getListing(let id): return "/v1/listings/\(id)"
        case .getScoreExplanation(let id): return "/v1/listings/\(id)/score-explanation"
        case .getListingHistory(let id): return "/v1/listings/\(id)/history"
        case .listFilters: return "/v1/filters"
        case .createFilter: return "/v1/filters"
        case .getFilter(let id): return "/v1/filters/\(id)"
        case .updateFilter(let id, _): return "/v1/filters/\(id)"
        case .deleteFilter(let id): return "/v1/filters/\(id)"
        case .testFilter(let id): return "/v1/filters/\(id)/test"
        case .listAlerts: return "/v1/alerts"
        case .updateAlert(let id, _): return "/v1/alerts/\(id)"
        case .getUnreadCount: return "/v1/alerts/unread-count"
        case .listSources: return "/v1/sources"
        case .updateSource(let id, _): return "/v1/sources/\(id)"
        }
    }

    var method: String {
        switch self {
        case .listListings, .getListing, .getScoreExplanation, .getListingHistory,
             .listFilters, .getFilter, .listAlerts, .getUnreadCount, .listSources:
            return "GET"
        case .createFilter, .testFilter:
            return "POST"
        case .updateFilter, .updateAlert, .updateSource:
            return "PATCH"
        case .deleteFilter:
            return "DELETE"
        }
    }

    var body: Data? {
        switch self {
        case .createFilter(let body), .updateFilter(_, let body),
             .updateAlert(_, let body), .updateSource(_, let body):
            return body
        default:
            return nil
        }
    }

    var queryItems: [URLQueryItem]? {
        switch self {
        case .listListings(let query):
            return query.toQueryItems()
        case .listAlerts(let query):
            return query?.toQueryItems()
        default:
            return nil
        }
    }
}

// MARK: - Query Parameter Types

struct ListingQuery {
    var status: String?
    var operationType: String?
    var propertyTypes: [String]?
    var districts: [Int]?
    var minPriceEur: Int?
    var maxPriceEur: Int?
    var minAreaSqm: Double?
    var maxAreaSqm: Double?
    var minRooms: Int?
    var maxRooms: Int?
    var minScore: Double?
    var requiredKeywords: [String]?
    var excludedKeywords: [String]?
    var sortBy: String?
    var limit: Int?
    var cursor: String?

    func toQueryItems() -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let v = status { items.append(.init(name: "status", value: v)) }
        if let v = operationType { items.append(.init(name: "operationType", value: v)) }
        if let v = propertyTypes, !v.isEmpty { items.append(.init(name: "propertyTypes", value: v.joined(separator: ","))) }
        if let v = districts, !v.isEmpty { items.append(.init(name: "districts", value: v.map(String.init).joined(separator: ","))) }
        if let v = minPriceEur { items.append(.init(name: "minPriceEur", value: String(v))) }
        if let v = maxPriceEur { items.append(.init(name: "maxPriceEur", value: String(v))) }
        if let v = minAreaSqm { items.append(.init(name: "minAreaSqm", value: String(v))) }
        if let v = maxAreaSqm { items.append(.init(name: "maxAreaSqm", value: String(v))) }
        if let v = minRooms { items.append(.init(name: "minRooms", value: String(v))) }
        if let v = maxRooms { items.append(.init(name: "maxRooms", value: String(v))) }
        if let v = minScore { items.append(.init(name: "minScore", value: String(v))) }
        if let v = sortBy { items.append(.init(name: "sortBy", value: v)) }
        if let v = limit { items.append(.init(name: "limit", value: String(v))) }
        if let v = cursor { items.append(.init(name: "cursor", value: v)) }
        return items
    }
}

struct AlertQuery {
    var status: String?
    var userFilterId: Int?
    var limit: Int?
    var cursor: String?

    func toQueryItems() -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let v = status { items.append(.init(name: "status", value: v)) }
        if let v = userFilterId { items.append(.init(name: "userFilterId", value: String(v))) }
        if let v = limit { items.append(.init(name: "limit", value: String(v))) }
        if let v = cursor { items.append(.init(name: "cursor", value: v)) }
        return items
    }
}
