import Foundation

enum SourceHealthStatus: String, Codable, CaseIterable, Hashable {
    case healthy
    case degraded
    case failing
    case disabled
    case unknown

    var displayName: String {
        switch self {
        case .healthy: "Healthy"
        case .degraded: "Degraded"
        case .failing: "Failing"
        case .disabled: "Disabled"
        case .unknown: "Unknown"
        }
    }

    /// Sort order for surfacing problems first: failing < degraded < unknown < healthy < disabled.
    var sortOrder: Int {
        switch self {
        case .failing: 0
        case .degraded: 1
        case .unknown: 2
        case .healthy: 3
        case .disabled: 4
        }
    }
}
