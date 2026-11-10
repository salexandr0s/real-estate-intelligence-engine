import Foundation

enum ListingStatus: String, Codable, CaseIterable, Hashable {
    case active
    case inactive
    case withdrawn
    case sold
    case rented
    case expired
    case unknown

    /// A status the app doesn't know decodes as `.unknown`.
    init(from decoder: any Decoder) throws {
        let rawValue = try decoder.singleValueContainer().decode(String.self)
        self = ListingStatus(rawValue: rawValue) ?? .unknown
    }
}
