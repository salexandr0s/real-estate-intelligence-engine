import Foundation

/// A document attached to a listing (e.g., exposé PDF, floor plan).
struct ListingDocument: Codable, Identifiable, Sendable {
    let id: Int
    let url: String
    let documentType: String
    let status: String
    let mimeType: String?
    let pageCount: Int?
    let label: String?
    let firstSeenAt: String
}

/// An extracted fact from a document.
struct DocumentFact: Codable, Identifiable, Sendable {
    let id: Int
    let factType: String
    let factValue: String
    let pageNumber: Int?
    let confidence: String
    let sourceSnippet: String?
}
