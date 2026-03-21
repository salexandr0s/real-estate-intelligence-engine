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
        case .listListings: "/v1/listings"
        case .getListing(let id): "/v1/listings/\(id)"
        case .getScoreExplanation(let id): "/v1/listings/\(id)/score-explanation"
        case .getListingHistory(let id): "/v1/listings/\(id)/history"
        case .listFilters: "/v1/filters"
        case .createFilter: "/v1/filters"
        case .getFilter(let id): "/v1/filters/\(id)"
        case .updateFilter(let id, _): "/v1/filters/\(id)"
        case .deleteFilter(let id): "/v1/filters/\(id)"
        case .testFilter(let id): "/v1/filters/\(id)/test"
        case .listAlerts: "/v1/alerts"
        case .updateAlert(let id, _): "/v1/alerts/\(id)"
        case .getUnreadCount: "/v1/alerts/unread-count"
        case .listSources: "/v1/sources"
        case .updateSource(let id, _): "/v1/sources/\(id)"
        }
    }

    var method: String {
        switch self {
        case .listListings, .getListing, .getScoreExplanation, .getListingHistory,
             .listFilters, .getFilter, .listAlerts, .getUnreadCount, .listSources:
            "GET"
        case .createFilter, .testFilter:
            "POST"
        case .updateFilter, .updateAlert, .updateSource:
            "PATCH"
        case .deleteFilter:
            "DELETE"
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
