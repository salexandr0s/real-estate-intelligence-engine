import Foundation
import Security

enum KeychainError: Error, LocalizedError {
    case unhandledError(status: OSStatus)

    var errorDescription: String? {
        switch self {
        case .unhandledError(let status):
            if let message = SecCopyErrorMessageString(status, nil) as? String {
                return message
            }
            return "Keychain error: \(status)"
        }
    }
}
