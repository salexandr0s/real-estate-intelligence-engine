import Foundation

/// Type-safe API endpoint definitions.
/// All paths are relative to the base URL (default: http://localhost:8080).
enum APIEndpoint {

    // MARK: - Listings

    case listListings(query: ListingQuery)
    case getListing(id: Int)
    case getScoreExplanation(listingId: Int)
    case getListingHistory(listingId: Int)
    case getListingCluster(listingId: Int)

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
    case bulkUpdateAlerts(body: Data)
    case getUnreadCount

    // MARK: - Sources

    case listSources
    case updateSource(id: Int, body: Data)
    case pauseAllSources
    case resumeAllSources
    case listScrapeRuns(limit: Int?)
    case createScrapeRun(body: Data)

    // MARK: - Watchlist

    case listSavedListings(limit: Int?, cursor: String?)
    case saveListing(body: Data)
    case unsaveListing(listingId: Int)
    case checkSavedListings(listingIds: [Int])
    case exportSavedListings

    // MARK: - Listings Export

    case exportListings(query: ListingQuery)

    // MARK: - Feedback

    case submitFeedback(body: Data)
    case getFeedback(listingId: Int)
    case deleteFeedback(listingId: Int)

    // MARK: - Dashboard

    case getDashboardStats
    case getDashboardVelocity
    case getScoreDistribution
    case getDistrictComparison

    // MARK: - Analysis

    case getAnalysis(listingId: Int)

    // MARK: - Documents

    case getDocuments(listingId: Int)
    case getDocumentFacts(documentId: Int)

    // MARK: - Analytics

    case getBaselines
    case getDistrictTrends(districtNo: Int?, operationType: String?, months: Int?)
    case getMarketTemperature

    // MARK: - Path & Method

    var path: String {
        switch self {
        case .listListings: "/v1/listings"
        case .getListing(let id): "/v1/listings/\(id)"
        case .getScoreExplanation(let id): "/v1/listings/\(id)/score-explanation"
        case .getListingHistory(let id): "/v1/listings/\(id)/history"
        case .getListingCluster(let id): "/v1/listings/\(id)/cluster"
        case .getAnalysis(let id): "/v1/listings/\(id)/analysis"
        case .getDocuments(let id): "/v1/listings/\(id)/documents"
        case .getDocumentFacts(let id): "/v1/documents/\(id)/facts"
        case .listFilters: "/v1/filters"
        case .createFilter: "/v1/filters"
        case .getFilter(let id): "/v1/filters/\(id)"
        case .updateFilter(let id, _): "/v1/filters/\(id)"
        case .deleteFilter(let id): "/v1/filters/\(id)"
        case .testFilter(let id): "/v1/filters/\(id)/test"
        case .listAlerts: "/v1/alerts"
        case .updateAlert(let id, _): "/v1/alerts/\(id)"
        case .bulkUpdateAlerts: "/v1/alerts/bulk"
        case .getUnreadCount: "/v1/alerts/unread-count"
        case .listSources: "/v1/sources"
        case .updateSource(let id, _): "/v1/sources/\(id)"
        case .pauseAllSources: "/v1/sources/pause-all"
        case .resumeAllSources: "/v1/sources/resume-all"
        case .listScrapeRuns: "/v1/scrape-runs"
        case .createScrapeRun: "/v1/scrape-runs"
        case .listSavedListings: "/v1/saved-listings"
        case .saveListing: "/v1/saved-listings"
        case .unsaveListing(let listingId): "/v1/saved-listings/\(listingId)"
        case .checkSavedListings: "/v1/saved-listings/check"
        case .exportSavedListings: "/v1/saved-listings/export"
        case .exportListings: "/v1/listings/export"
        case .submitFeedback: "/v1/feedback"
        case .getFeedback(let listingId): "/v1/feedback/\(listingId)"
        case .deleteFeedback(let listingId): "/v1/feedback/\(listingId)"
        case .getDashboardStats: "/v1/dashboard/stats"
        case .getDashboardVelocity: "/v1/dashboard/velocity"
        case .getScoreDistribution: "/v1/analytics/score-distribution"
        case .getDistrictComparison: "/v1/analytics/district-comparison"
        case .getBaselines: "/v1/analytics/baselines"
        case .getDistrictTrends: "/v1/analytics/district-trends"
        case .getMarketTemperature: "/v1/analytics/market-temperature"
        }
    }

    var method: String {
        switch self {
        case .listListings, .getListing, .getScoreExplanation, .getListingHistory,
             .listFilters, .getFilter, .listAlerts, .getUnreadCount, .listSources, .getListingCluster, .listScrapeRuns,
             .getAnalysis, .getDocuments, .getDocumentFacts,
             .listSavedListings, .checkSavedListings, .exportSavedListings, .exportListings,
             .getDashboardStats, .getDashboardVelocity,
             .getScoreDistribution, .getDistrictComparison,
             .getBaselines, .getDistrictTrends, .getMarketTemperature,
             .getFeedback:
            "GET"
        case .createFilter, .testFilter, .pauseAllSources, .resumeAllSources, .saveListing,
             .submitFeedback, .createScrapeRun:
            "POST"
        case .updateFilter, .updateAlert, .bulkUpdateAlerts, .updateSource:
            "PATCH"
        case .deleteFilter, .unsaveListing, .deleteFeedback:
            "DELETE"
        }
    }

    var body: Data? {
        switch self {
        case .createFilter(let body), .updateFilter(_, let body),
             .updateAlert(_, let body), .bulkUpdateAlerts(let body),
             .updateSource(_, let body),
             .saveListing(let body), .submitFeedback(let body),
             .createScrapeRun(let body):
            return body
        default:
            return nil
        }
    }

    var queryItems: [URLQueryItem]? {
        switch self {
        case .listListings(let query), .exportListings(let query):
            return query.toQueryItems()
        case .listAlerts(let query):
            return query?.toQueryItems()
        case .listScrapeRuns(let limit):
            if let l = limit { return [URLQueryItem(name: "limit", value: "\(l)")] }
            return nil
        case .listSavedListings(let limit, let cursor):
            var items: [URLQueryItem] = []
            if let l = limit { items.append(URLQueryItem(name: "limit", value: "\(l)")) }
            if let c = cursor { items.append(URLQueryItem(name: "cursor", value: c)) }
            return items.isEmpty ? nil : items
        case .checkSavedListings(let listingIds):
            let ids = listingIds.map(String.init).joined(separator: ",")
            return [URLQueryItem(name: "listingIds", value: ids)]
        case .getDistrictTrends(let districtNo, let operationType, let months):
            var items: [URLQueryItem] = []
            if let d = districtNo { items.append(URLQueryItem(name: "districtNo", value: "\(d)")) }
            if let o = operationType { items.append(URLQueryItem(name: "operationType", value: o)) }
            if let m = months { items.append(URLQueryItem(name: "months", value: "\(m)")) }
            return items.isEmpty ? nil : items
        default:
            return nil
        }
    }
}
