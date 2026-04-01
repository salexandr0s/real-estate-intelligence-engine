import Foundation

/// Thread-safe file-based cache for API responses.
/// Stores JSON data in the Application Support directory with TTL-based staleness.
actor CacheManager {

    // MARK: - Singleton

    static let shared = CacheManager()

    // MARK: - Properties

    private let fileManager = FileManager.default

    nonisolated private var cacheDirectory: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let cacheDir = appSupport
            .appendingPathComponent("ImmoRadar", isDirectory: true)
            .appendingPathComponent("Cache", isDirectory: true)
        return cacheDir
    }

    // MARK: - Init

    private init() {
        // Create cache directory synchronously during init
        let dir = cacheDirectory
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    // MARK: - Public API

    /// Retrieve cached data for a given key, or nil if not found.
    func cache(key: String) -> Data? {
        let fileURL = cacheFileURL(for: key)
        guard fileManager.fileExists(atPath: fileURL.path) else { return nil }
        return try? Data(contentsOf: fileURL)
    }

    /// Store data under a given key.
    func store(data: Data, for key: String) {
        ensureCacheDirectoryExists()
        let fileURL = cacheFileURL(for: key)
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Check whether cached data for a key is older than maxAge seconds.
    /// Returns true if no cache exists or if the cache has expired.
    func isStale(key: String, maxAge: TimeInterval = 300) -> Bool {
        let fileURL = cacheFileURL(for: key)
        guard let attributes = try? fileManager.attributesOfItem(atPath: fileURL.path),
              let modificationDate = attributes[.modificationDate] as? Date
        else {
            return true
        }
        return Date.now.timeIntervalSince(modificationDate) > maxAge
    }

    /// Remove all cached files.
    func clear() {
        guard fileManager.fileExists(atPath: cacheDirectory.path) else { return }
        if let files = try? fileManager.contentsOfDirectory(atPath: cacheDirectory.path) {
            for file in files {
                let filePath = cacheDirectory.appendingPathComponent(file)
                try? fileManager.removeItem(at: filePath)
            }
        }
    }

    // MARK: - Private Helpers

    private func cacheFileURL(for key: String) -> URL {
        let safeKey = key
            .replacing("/", with: "_")
            .replacing(":", with: "_")
        return cacheDirectory.appendingPathComponent("\(safeKey).json")
    }

    private func ensureCacheDirectoryExists() {
        if !fileManager.fileExists(atPath: cacheDirectory.path) {
            try? fileManager.createDirectory(
                at: cacheDirectory,
                withIntermediateDirectories: true
            )
        }
    }
}
