import Foundation

/// The query of GET /v1/listings and GET /v1/listings/export (`listingSearchQuerySchema` in
/// apps/api/src/schemas.ts). Keyword filters live on saved filters only; the search doesn't read them.
struct ListingQuery {
    /// active, inactive, sold, rented, withdrawn, expired or unknown. The server defaults to active.
    var status: String?
    var operationType: String?
    var propertyTypes: [String]?
    var districts: [Int]?
    var minPriceEur: Int?
    var maxPriceEur: Int?
    var minAreaSqm: Double?
    var maxAreaSqm: Double?
    var minRooms: Double?
    var maxRooms: Double?
    var minScore: Double?
    /// score_desc, newest, price_asc, price_desc or sqm_desc.
    var sortBy: String?
    /// 1 to 200. The export ignores it.
    var limit: Int?
    var cursor: String?

    /// The search parameters, without paging.
    func filterQueryItems() -> [URLQueryItem] {
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
        return items
    }

    /// The search parameters plus paging, for GET /v1/listings.
    func toQueryItems() -> [URLQueryItem] {
        var items = filterQueryItems()
        if let v = limit { items.append(.init(name: "limit", value: String(v))) }
        if let v = cursor { items.append(.init(name: "cursor", value: v)) }
        return items
    }
}
