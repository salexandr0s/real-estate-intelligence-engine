import XCTest
@testable import ImmoRadar

@MainActor
final class ConnectionStatePortMigrationTests: XCTestCase {
    private let suiteName = "ConnectionStatePortMigrationTests"
    private var defaults: UserDefaults!

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    private func migrated(from stored: String) -> String? {
        defaults.set(stored, forKey: "apiBaseURL")
        ConnectionState.migrateDefaultPortIfNeeded(defaults: defaults)
        return defaults.string(forKey: "apiBaseURL")
    }

    func testLocalURLOnTheOldPortMoves() {
        XCTAssertEqual(migrated(from: "http://localhost:8080"), "http://localhost:58080")
    }

    /// A stored server address must keep working after the update.
    func testRemoteURLOnTheOldPortStays() {
        XCTAssertEqual(migrated(from: "https://api.example.com:8080"), "https://api.example.com:8080")
    }

    /// Someone who points the app at a local server on 8080 after the update keeps that choice.
    func testMigrationRunsOnce() {
        XCTAssertEqual(migrated(from: "http://127.0.0.1:8080"), "http://127.0.0.1:58080")
        XCTAssertEqual(migrated(from: "http://127.0.0.1:8080"), "http://127.0.0.1:8080")
    }
}
