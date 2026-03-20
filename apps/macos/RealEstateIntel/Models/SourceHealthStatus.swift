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
}
