import Foundation

/// Raw values are the server's `filter_kind` values.
enum FilterKind: String, Codable, CaseIterable, Hashable {
    case alert
    case saved = "listing_search"
}
