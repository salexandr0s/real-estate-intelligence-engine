import Foundation

/// A versioned snapshot of a listing's key fields at a point in time.
/// Maps to the `/v1/listings/{id}/history` API response.
struct ListingVersion: Identifiable, Codable {
    let id: Int
    let versionNo: Int
    let versionReason: String
    let listPriceEurCents: Int?
    let observedAt: Date
}

// MARK: - API DTO

struct APIListingVersionResponse: Codable {
    let id: Int
    let versionNo: Int
    let versionReason: String
    let listPriceEurCents: Int?
    let observedAt: String
}
