import Foundation

enum AlertSortBy: String, Codable, CaseIterable, Hashable {
    case age
    case district
    case price

    var displayName: String {
        switch self {
        case .age: "Age"
        case .district: "District"
        case .price: "Price"
        }
    }
}

enum AlertSortDirection: String, Codable, CaseIterable, Hashable {
    case asc
    case desc

    var displayName: String {
        switch self {
        case .asc: "Ascending"
        case .desc: "Descending"
        }
    }

    var iconName: String {
        switch self {
        case .asc: "arrow.up"
        case .desc: "arrow.down"
        }
    }
}

/// An alert status as the server stores it. The app's `AlertStatus.unread` covers `queued` and `sent`.
enum AlertServerStatus: String, CaseIterable, Hashable, Sendable {
    case queued
    case sent
    case failed
    case dismissed
    case opened
    case suppressed
}

/// The query of GET /v1/alerts (`alertListQuerySchema` in apps/api/src/schemas.ts).
struct AlertQuery {
    var status: AlertServerStatus?
    /// Only alerts raised by this filter.
    var userFilterId: Int?
    /// 1 to 200.
    var limit: Int?
    var cursor: String?
    var sortBy: AlertSortBy = .age
    var sortDirection: AlertSortDirection = .desc

    func toQueryItems() -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let v = status { items.append(.init(name: "status", value: v.rawValue)) }
        if let v = userFilterId { items.append(.init(name: "userFilterId", value: String(v))) }
        if let v = limit { items.append(.init(name: "limit", value: String(v))) }
        if let v = cursor { items.append(.init(name: "cursor", value: v)) }
        items.append(.init(name: "sortBy", value: sortBy.rawValue))
        items.append(.init(name: "sortDirection", value: sortDirection.rawValue))
        return items
    }
}
