import Foundation

struct OutreachEvent: Identifiable, Codable, Hashable, Sendable {
    let id: Int
    let eventType: String
    let fromState: String?
    let toState: String?
    let payload: [String: String]?
    let occurredAt: Date?
}
