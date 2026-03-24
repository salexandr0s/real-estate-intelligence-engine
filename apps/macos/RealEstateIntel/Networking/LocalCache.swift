import Foundation

/// In-memory TTL cache for API responses.
/// Avoids redundant network calls within the configured time-to-live window.
@MainActor @Observable
final class LocalCache {
    private var store: [String: CacheEntry] = [:]
    private let ttl: TimeInterval

    init(ttl: TimeInterval = 300) {
        self.ttl = ttl
    }

    func get<T: Decodable>(_ key: String, as type: T.Type) -> T? {
        guard let entry = store[key], entry.expiry > Date.now else {
            store.removeValue(forKey: key)
            return nil
        }
        return try? JSONDecoder().decode(type, from: entry.data)
    }

    func set<T: Encodable>(_ key: String, value: T) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        store[key] = CacheEntry(data: data, expiry: Date.now.addingTimeInterval(ttl))
    }

    func invalidate(_ key: String) {
        store.removeValue(forKey: key)
    }

    func invalidateAll() {
        store.removeAll()
    }

    private struct CacheEntry {
        let data: Data
        let expiry: Date
    }
}
