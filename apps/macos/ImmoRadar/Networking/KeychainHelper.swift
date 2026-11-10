import Foundation
import LocalAuthentication
import Security

/// What one Keychain read found. A failed read says nothing about the item, so it must never be
/// treated as a missing or empty value.
enum KeychainReadResult: Equatable, Sendable {
    case found(String)
    case notFound
    case failed(OSStatus)

    /// The stored value, or nil when there is none or it couldn't be read.
    var value: String? {
        guard case .found(let value) = self else { return nil }
        return value
    }
}

/// Lightweight wrapper around the macOS Keychain for storing sensitive strings.
enum KeychainHelper {

    static let defaultServiceName = "com.immoradar.api"

    // MARK: - Read

    static func read(
        key: String,
        service: String = defaultServiceName,
        allowUserInteraction: Bool = true
    ) -> KeychainReadResult {
        let context = LAContext()
        context.interactionNotAllowed = !allowUserInteraction

        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context,
        ]
        if !allowUserInteraction {
            // The login keychain ignores the context's interactionNotAllowed. For an item that a build
            // with another signature saved, it asks for the login password, and the read waits for the
            // answer. It respects this deprecated key and fails with errSecInteractionNotAllowed.
            query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        }

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        switch status {
        case errSecSuccess:
            // An item that isn't UTF-8 text can't be used, and it isn't safe to replace either.
            guard let data = result as? Data, let string = String(data: data, encoding: .utf8) else {
                return .failed(errSecDecode)
            }
            return .found(string)
        case errSecItemNotFound:
            return .notFound
        default:
            return .failed(status)
        }
    }

    // MARK: - Write

    /// Updates the item in place and adds one only when there is none. It never deletes first, so
    /// a write that fails leaves the old value where it was.
    static func set(
        key: String,
        value: String,
        service: String = defaultServiceName
    ) throws {
        let itemQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        let data = Data(value.utf8)
        let changes = [kSecValueData as String: data] as CFDictionary

        var status = SecItemUpdate(itemQuery as CFDictionary, changes)
        if status == errSecItemNotFound {
            var addQuery = itemQuery
            addQuery[kSecValueData as String] = data
            status = SecItemAdd(addQuery as CFDictionary, nil)
            if status == errSecDuplicateItem {
                // Another writer added the item in between, so update that one.
                status = SecItemUpdate(itemQuery as CFDictionary, changes)
            }
        }

        guard status == errSecSuccess else {
            throw KeychainError.unhandledError(status: status)
        }
    }

    // MARK: - Delete

    @discardableResult
    static func delete(key: String, service: String = defaultServiceName) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}

// MARK: - Secret Store

/// The Keychain calls that stored secrets need. The rules for when to delete live in the extension
/// below, so tests can check them against an in-memory store instead of the real Keychain.
protocol SecretStore: Sendable {
    func read(key: String, allowUserInteraction: Bool) -> KeychainReadResult
    func write(key: String, value: String) throws
    @discardableResult func delete(key: String) -> Bool
}

/// One Keychain service.
struct KeychainStore: SecretStore {
    /// Holds the connection token and the Copilot API keys.
    static let api = KeychainStore(service: KeychainHelper.defaultServiceName)

    let service: String

    func read(key: String, allowUserInteraction: Bool) -> KeychainReadResult {
        KeychainHelper.read(key: key, service: service, allowUserInteraction: allowUserInteraction)
    }

    func write(key: String, value: String) throws {
        try KeychainHelper.set(key: key, value: value, service: service)
    }

    @discardableResult
    func delete(key: String) -> Bool {
        KeychainHelper.delete(key: key, service: service)
    }
}

/// What a read means for the copy of a secret kept in memory.
enum SecretLoad: Equatable, Sendable {
    /// Use this value. It is empty when nothing is stored.
    case value(String)
    /// The read failed. Keep the copy in memory, and the stored item, as they are.
    case unreadable(OSStatus)
}

extension SecretStore {
    /// Reads a secret. An item that reads back empty is a stale entry from an older build, so it
    /// is deleted. A failed read deletes nothing.
    func load(key: String, allowUserInteraction: Bool) -> SecretLoad {
        switch read(key: key, allowUserInteraction: allowUserInteraction) {
        case .found(let value):
            if value.isEmpty {
                delete(key: key)
            }
            return .value(value)
        case .notFound:
            return .value("")
        case .failed(let status):
            return .unreadable(status)
        }
    }

    /// Saves the value, or deletes the item when the value is empty. Saving never deletes.
    func save(key: String, value: String) throws {
        if value.isEmpty {
            delete(key: key)
        } else {
            try write(key: key, value: value)
        }
    }

    /// Deletes the item only when it reads back empty.
    func deleteIfEmpty(key: String, allowUserInteraction: Bool) {
        guard read(key: key, allowUserInteraction: allowUserInteraction) == .found("") else { return }
        delete(key: key)
    }
}
