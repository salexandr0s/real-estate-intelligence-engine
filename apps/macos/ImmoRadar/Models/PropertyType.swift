import Foundation

enum PropertyType: String, Codable, CaseIterable, Hashable, Identifiable {
    case apartment
    case house
    case land
    case commercial
    case parking
    case other

    /// A type the app doesn't know decodes as `.other`, so one new server value can't fail a whole list.
    init(from decoder: any Decoder) throws {
        let rawValue = try decoder.singleValueContainer().decode(String.self)
        self = PropertyType(rawValue: rawValue) ?? .other
    }

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .apartment: "Apartment"
        case .house: "House"
        case .land: "Land"
        case .commercial: "Commercial"
        case .parking: "Parking"
        case .other: "Other"
        }
    }
}
