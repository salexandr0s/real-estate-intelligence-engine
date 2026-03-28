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

struct AlertQuery {
    var status: String?
    var userFilterId: Int?
    var limit: Int?
    var cursor: String?
    var sortBy: AlertSortBy = .age
    var sortDirection: AlertSortDirection = .desc

    func toQueryItems() -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let v = status { items.append(.init(name: "status", value: v)) }
        if let v = userFilterId { items.append(.init(name: "userFilterId", value: String(v))) }
        if let v = limit { items.append(.init(name: "limit", value: String(v))) }
        if let v = cursor { items.append(.init(name: "cursor", value: v)) }
        items.append(.init(name: "sortBy", value: sortBy.rawValue))
        items.append(.init(name: "sortDirection", value: sortDirection.rawValue))
        return items
    }
}
