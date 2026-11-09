import os
import Security
import XCTest
@testable import ImmoRadar

/// Keeps items in memory, so the secret rules run without touching the real Keychain.
final class InMemorySecretStore: SecretStore {
    private struct State {
        var items: [String: String] = [:]
        var readFailure: OSStatus?
        var deleteCount = 0
    }

    private let state: OSAllocatedUnfairLock<State>

    init(items: [String: String] = [:], readFailure: OSStatus? = nil) {
        state = OSAllocatedUnfairLock(initialState: State(items: items, readFailure: readFailure))
    }

    var items: [String: String] { state.withLock { $0.items } }
    var deleteCount: Int { state.withLock { $0.deleteCount } }

    func read(key: String, allowUserInteraction: Bool) -> KeychainReadResult {
        state.withLock { state in
            if let failure = state.readFailure { return .failed(failure) }
            guard let value = state.items[key] else { return .notFound }
            return .found(value)
        }
    }

    func write(key: String, value: String) throws {
        state.withLock { $0.items[key] = value }
    }

    @discardableResult
    func delete(key: String) -> Bool {
        state.withLock { state in
            state.deleteCount += 1
            state.items[key] = nil
            return true
        }
    }
}

@MainActor
final class KeychainStoreTests: XCTestCase {
    /// A denied or interrupted read on an unsigned build used to erase the stored token.
    func testFailedReadLeavesTheTokenAndTheValueInMemory() {
        let store = InMemorySecretStore(items: ["apiToken": "stored"], readFailure: errSecInteractionNotAllowed)
        let state = ConnectionState(secretStore: store)
        state.updateAPIToken("in-memory")

        state.loadConnectionSecretsIfNeeded(allowUserInteraction: true)

        XCTAssertEqual(state.apiToken, "in-memory")
        XCTAssertEqual(store.items["apiToken"], "stored")
        XCTAssertEqual(store.deleteCount, 0)
    }

    func testFailedReadLeavesTheCopilotKeys() {
        let store = InMemorySecretStore(items: ["anthropicApiKey": "key"], readFailure: errSecAuthFailed)
        let state = CopilotSettingsState(secretStore: store)

        state.loadCopilotSecretsIfNeeded(allowUserInteraction: true)

        XCTAssertEqual(store.items["anthropicApiKey"], "key")
        XCTAssertEqual(store.deleteCount, 0)
        XCTAssertNil(state.hasAPIKeyForActiveProvider)
    }

    func testEmptyStoredTokenIsDeleted() {
        let store = InMemorySecretStore(items: ["apiToken": ""])
        let state = ConnectionState(secretStore: store)

        state.loadConnectionSecretsIfNeeded(allowUserInteraction: false)

        XCTAssertNil(store.items["apiToken"])
        XCTAssertEqual(state.apiToken, "")
    }

    func testSavingReplacesTheTokenWithoutDeleting() {
        let store = InMemorySecretStore(items: ["apiToken": "old"])
        let state = ConnectionState(secretStore: store)

        XCTAssertTrue(state.persistAPIToken("new"))

        XCTAssertEqual(store.items["apiToken"], "new")
        XCTAssertEqual(store.deleteCount, 0)
    }

    func testLocalTokenIsNotReplacedAfterAFailedRead() {
        let key = LocalRuntimeAuth.keychainKey
        let store = InMemorySecretStore(items: [key: "engine-token"], readFailure: errSecInteractionNotAllowed)

        XCTAssertThrowsError(try LocalRuntimeAuth.ensureToken(in: store))

        XCTAssertEqual(store.items[key], "engine-token")
    }

    func testLocalTokenIsMadeWhenNoneIsStored() throws {
        let store = InMemorySecretStore()

        let token = try LocalRuntimeAuth.ensureToken(in: store)

        XCTAssertEqual(token.count, 64)
        XCTAssertEqual(store.items[LocalRuntimeAuth.keychainKey], token)
        XCTAssertEqual(try LocalRuntimeAuth.ensureToken(in: store), token)
    }
}

final class CopilotChatRequestTests: XCTestCase {
    /// The chat route refuses more than 50 messages.
    func testHistoryKeepsTheLatestMessagesFromAUserTurn() {
        let messages = (0...60).map { index in
            CopilotMessage(
                role: index.isMultiple(of: 2) ? .user : .assistant,
                contentBlocks: [ContentBlock(.text("message \(index)"))]
            )
        }

        let history = CopilotChatRequest.history(from: messages)

        XCTAssertLessThanOrEqual(history.count, CopilotChatRequest.maxMessages)
        XCTAssertEqual(history.first?.role, "user")
        XCTAssertEqual(history.last?.content, "message 60")
    }

    func testAnswerWithOnlyCardsIsSentAsText() {
        let messages = [
            CopilotMessage(role: .user, contentBlocks: [ContentBlock(.text("Market overview"))]),
            CopilotMessage(role: .assistant, contentBlocks: [ContentBlock(.marketStats([]))]),
            CopilotMessage(role: .user, contentBlocks: [ContentBlock(.text("And district 2?"))]),
        ]

        let history = CopilotChatRequest.history(from: messages)

        XCTAssertEqual(history.count, 3)
        XCTAssertFalse(history[1].content.isEmpty)
    }

    func testErrorEnvelopeMessageIsShown() {
        let body = Data(#"{"error":{"code":"validation_error","message":"Start a new chat to continue.","details":{"issues":[1]}}}"#.utf8)

        XCTAssertEqual(
            CopilotStreamService.failureMessage(statusCode: 400, body: body),
            "Start a new chat to continue."
        )
    }
}

final class HealthProbeTests: XCTestCase {
    func testDegradedReportNamesTheDependencyThatIsDown() throws {
        let body = Data(#"{"status":"degraded","timestamp":"2026-11-09T00:00:00Z","version":"0.1.0","checks":{"postgres":"error","redis":"ok"}}"#.utf8)

        let report = try JSONDecoder().decode(HealthProbe.Report.self, from: body)

        XCTAssertEqual(report.issueMessage, "The database isn't responding.")
    }

    func testHealthyReportHasNoIssue() throws {
        let body = Data(#"{"status":"ok","checks":{"postgres":"ok","redis":"ok"}}"#.utf8)

        XCTAssertNil(try JSONDecoder().decode(HealthProbe.Report.self, from: body).issueMessage)
    }
}
