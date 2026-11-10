import Foundation
import Security

enum KeychainError: Error, LocalizedError {
    case unhandledError(status: OSStatus)
    /// The item couldn't be read, so it was left as it is instead of being replaced.
    case readFailed(status: OSStatus)

    var status: OSStatus {
        switch self {
        case .unhandledError(let status), .readFailed(let status): status
        }
    }

    var errorDescription: String? {
        switch self {
        case .unhandledError(let status):
            return Self.describe(status)
        case .readFailed(let status):
            return "ImmoRadar couldn’t read its Keychain item, so it left the item unchanged. \(Self.describe(status))"
        }
    }

    private static func describe(_ status: OSStatus) -> String {
        if let message = SecCopyErrorMessageString(status, nil) as? String {
            return message
        }
        return "Keychain error: \(status)"
    }
}
