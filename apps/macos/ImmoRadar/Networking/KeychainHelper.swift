import Foundation
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

    /// Every Keychain call holds this lock. A quiet call turns off the process-wide prompt setting
    /// while it holds the lock, so a call that may ask never runs with the setting off.
    private static let accessLock = NSLock()

    // MARK: - Read

    /// A quiet read (`allowUserInteraction: false`) never asks and never waits. It fails when the
    /// item needs the login password, and while another call may be waiting on the user.
    static func read(
        key: String,
        service: String = defaultServiceName,
        allowUserInteraction: Bool = true
    ) -> KeychainReadResult {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = access(allowUserInteraction: allowUserInteraction) {
            SecItemCopyMatching(query as CFDictionary, &result)
        }

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

        let status = access(allowUserInteraction: true) {
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
            return status
        }

        guard status == errSecSuccess else {
            throw KeychainError.unhandledError(status: status)
        }
    }

    // MARK: - Delete

    @discardableResult
    static func delete(
        key: String,
        service: String = defaultServiceName,
        allowUserInteraction: Bool = true
    ) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]

        let status = access(allowUserInteraction: allowUserInteraction) {
            SecItemDelete(query as CFDictionary)
        }
        return status == errSecSuccess || status == errSecItemNotFound
    }

    // MARK: - Prompts

    /// Runs one Keychain call. A call that may ask waits for the lock. A quiet call fails with
    /// errSecInteractionNotAllowed when the lock is taken, because its holder may be waiting on
    /// the user, and otherwise runs with the prompt turned off.
    private static func access(allowUserInteraction: Bool, _ call: () -> OSStatus) -> OSStatus {
        guard allowUserInteraction else {
            guard accessLock.try() else { return errSecInteractionNotAllowed }
            defer { accessLock.unlock() }
            // The login keychain ignores the query's own switches for this
            // (LAContext.interactionNotAllowed, kSecUseAuthenticationUIFail): for an item that a
            // build with another signature saved, it asks for the login password, and the call
            // waits for the answer. It respects this deprecated process-wide setting and fails the
            // call at once with errSecAuthFailed. Nothing else in the app changes the setting.
            SecKeychainSetUserInteractionAllowed(false)
            defer { SecKeychainSetUserInteractionAllowed(true) }
            return call()
        }
        accessLock.lock()
        defer { accessLock.unlock() }
        return call()
    }
}

// MARK: - Secret Store

/// The Keychain calls that stored secrets need. The rules for when to delete live in the extension
/// below, so tests can check them against an in-memory store instead of the real Keychain.
protocol SecretStore: Sendable {
    func read(key: String, allowUserInteraction: Bool) -> KeychainReadResult
    func write(key: String, value: String) throws
    @discardableResult func delete(key: String, allowUserInteraction: Bool) -> Bool
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
    func delete(key: String, allowUserInteraction: Bool) -> Bool {
        KeychainHelper.delete(key: key, service: service, allowUserInteraction: allowUserInteraction)
    }
}

/// Copies a legacy secret once, leaving the original available for rollback.
/// A quiet read never writes or prompts. A failed destination read never falls
/// back to the legacy value, which may be older than the current credential.
struct MigratingSecretStore: SecretStore {
    let current: any SecretStore
    let legacy: any SecretStore

    func read(key: String, allowUserInteraction: Bool) -> KeychainReadResult {
        let result = current.read(key: key, allowUserInteraction: allowUserInteraction)
        guard result == .notFound else { return result }

        let previous = legacy.read(key: key, allowUserInteraction: allowUserInteraction)
        guard allowUserInteraction, case .found(let value) = previous, !value.isEmpty else {
            return previous
        }

        do {
            try current.write(key: key, value: value)
        } catch {
            return .failed((error as? KeychainError)?.status ?? errSecInternalComponent)
        }

        // Persisted access, rather than this process's cache, must work before the
        // engine accepts the migration. No failure deletes or replaces the legacy item.
        switch current.read(key: key, allowUserInteraction: false) {
        case .found(let stored) where stored == value:
            return .found(stored)
        case .failed(let status):
            return .failed(status)
        case .found, .notFound:
            return .failed(errSecDecode)
        }
    }

    func write(key: String, value: String) throws {
        try current.write(key: key, value: value)
    }

    @discardableResult
    func delete(key: String, allowUserInteraction: Bool) -> Bool {
        guard current.delete(key: key, allowUserInteraction: allowUserInteraction) else { return false }
        // An explicit reset must also remove the rollback copy, so it cannot be
        // imported again on the next launch.
        return legacy.delete(key: key, allowUserInteraction: allowUserInteraction)
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
                delete(key: key, allowUserInteraction: allowUserInteraction)
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
            delete(key: key, allowUserInteraction: true)
        } else {
            try write(key: key, value: value)
        }
    }

    /// Deletes the item only when it reads back empty.
    func deleteIfEmpty(key: String, allowUserInteraction: Bool) {
        guard read(key: key, allowUserInteraction: allowUserInteraction) == .found("") else { return }
        delete(key: key, allowUserInteraction: allowUserInteraction)
    }
}
