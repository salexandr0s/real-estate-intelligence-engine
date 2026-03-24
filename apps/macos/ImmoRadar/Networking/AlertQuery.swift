import Foundation

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
