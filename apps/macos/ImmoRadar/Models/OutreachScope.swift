import Foundation

enum OutreachScope: String, Codable, CaseIterable, Sendable {
    case open
    case closed
    case all

    /// Whether the server lists `thread` in this scope. Mirrors the scope filter of the thread
    /// list query in packages/db/src/queries/outreach.ts.
    func includes(_ thread: OutreachThread) -> Bool {
        switch self {
        case .open: thread.workflowState != "closed"
        case .closed: thread.workflowState == "closed"
        case .all: true
        }
    }
}
