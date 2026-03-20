import Foundation

enum ListingStatus: String, Codable, CaseIterable, Hashable {
    case active
    case inactive
    case withdrawn
    case sold
    case rented
    case expired
    case unknown
}
