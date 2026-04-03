import Foundation

struct OutreachStartInput: Codable, Sendable {
    let subject: String
    let bodyText: String
    let contactEmail: String?
    let contactName: String?
    let contactCompany: String?
    let contactPhone: String?
}
