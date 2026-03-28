import Foundation

enum SourceHealthStatus: String, Codable, CaseIterable, Hashable {
    case healthy
    case degraded
    case blocked
    case disabled
    case unknown

    var displayName: String {
        switch self {
        case .healthy: "Healthy"
        case .degraded: "Degraded"
        case .blocked: "Blocked"
        case .disabled: "Disabled"
        case .unknown: "Unknown"
        }
    }

    /// Sort order for surfacing problems first: blocked < degraded < unknown < healthy < disabled.
    var sortOrder: Int {
        switch self {
        case .blocked: 0
        case .degraded: 1
        case .unknown: 2
        case .healthy: 3
        case .disabled: 4
        }
    }
}
