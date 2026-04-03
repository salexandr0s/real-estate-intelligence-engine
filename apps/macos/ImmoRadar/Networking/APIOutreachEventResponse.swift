import Foundation

struct APIOutreachEventResponse: Codable, Sendable {
    let id: Int
    let eventType: String
    let fromState: String?
    let toState: String?
    let payload: [String: String]?
    let occurredAt: String

    func toDomain() -> OutreachEvent {
        OutreachEvent(
            id: id,
            eventType: eventType,
            fromState: fromState,
            toState: toState,
            payload: payload,
            occurredAt: Date.fromISO(occurredAt)
        )
    }
}
