import Foundation

enum PropertyType: String, Codable, CaseIterable, Hashable, Identifiable {
    case apartment
    case house
    case land
    case commercial
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .apartment: "Apartment"
        case .house: "House"
        case .land: "Land"
        case .commercial: "Commercial"
        case .other: "Other"
        }
    }
}
