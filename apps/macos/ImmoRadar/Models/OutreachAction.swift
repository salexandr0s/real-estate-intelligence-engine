import Foundation

enum OutreachAction: String, Codable, Sendable {
    case pause
    case resume
    case close
    case retry
}
