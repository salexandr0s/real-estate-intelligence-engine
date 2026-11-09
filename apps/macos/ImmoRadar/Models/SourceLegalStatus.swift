import Foundation

/// Whether a source may be scraped, as the server's `legal_status` says.
enum SourceLegalStatus: String, Codable, CaseIterable, Hashable {
    case approved
    case reviewRequired = "review_required"
    /// The source can't run and can't be switched on.
    case disabled
    case unknown

    /// A status the app doesn't know decodes as `.unknown`.
    init(from decoder: any Decoder) throws {
        let rawValue = try decoder.singleValueContainer().decode(String.self)
        self = SourceLegalStatus(rawValue: rawValue) ?? .unknown
    }

    var displayName: String {
        switch self {
        case .approved: "Approved"
        case .reviewRequired: "Review Required"
        case .disabled: "Disabled"
        case .unknown: "Unknown"
        }
    }
}
