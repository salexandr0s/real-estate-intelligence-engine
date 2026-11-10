import os
import Security
import XCTest
@testable import ImmoRadar

/// Keeps items in memory, so the secret rules run without touching the real Keychain.
final class InMemorySecretStore: SecretStore {
    struct Read: Equatable {
        let key: String
        let allowsUserInteraction: Bool
    }

    private struct State {
        var items: [String: String] = [:]
        var readFailure: OSStatus?
        var writeFailure: OSStatus?
        var readFailureAfterWrite: OSStatus?
        var deleteCount = 0
        var reads: [Read] = []
    }

    private let state: OSAllocatedUnfairLock<State>

    init(
        items: [String: String] = [:],
        readFailure: OSStatus? = nil,
        writeFailure: OSStatus? = nil,
        readFailureAfterWrite: OSStatus? = nil
    ) {
        state = OSAllocatedUnfairLock(initialState: State(
            items: items,
            readFailure: readFailure,
            writeFailure: writeFailure,
            readFailureAfterWrite: readFailureAfterWrite
        ))
    }

    var items: [String: String] { state.withLock { $0.items } }
    var deleteCount: Int { state.withLock { $0.deleteCount } }
    /// Every read so far, oldest first.
    var reads: [Read] { state.withLock { $0.reads } }

    /// Makes later reads fail with `status`, or succeed again when it is nil.
    func failReads(with status: OSStatus?) {
        state.withLock { $0.readFailure = status }
    }

    func read(key: String, allowUserInteraction: Bool) -> KeychainReadResult {
        state.withLock { state in
            state.reads.append(Read(key: key, allowsUserInteraction: allowUserInteraction))
            if let failure = state.readFailure { return .failed(failure) }
            guard let value = state.items[key] else { return .notFound }
            return .found(value)
        }
    }

    func write(key: String, value: String) throws {
        try state.withLock {
            if let status = $0.writeFailure { throw KeychainError.unhandledError(status: status) }
            $0.items[key] = value
            if let status = $0.readFailureAfterWrite { $0.readFailure = status }
        }
    }

    @discardableResult
    func delete(key: String, allowUserInteraction: Bool) -> Bool {
        state.withLock { state in
            state.deleteCount += 1
            state.items[key] = nil
            return true
        }
    }
}

@MainActor
final class KeychainStoreTests: XCTestCase {
    func testDevelopmentBuildDoesNotUseTheReleaseCredentialService() {
        #if DEBUG
        XCTAssertEqual(LocalRuntimeAuth.keychainService, "com.immoradar.local-runtime.debug")
        #else
        XCTAssertEqual(LocalRuntimeAuth.keychainService, "com.immoradar.local-runtime.v2")
        #endif
        XCTAssertNotEqual(LocalRuntimeAuth.keychainService, LocalRuntimeAuth.legacyKeychainService)
    }

    func testRuntimeMigrationCopiesOnceAndLaterLaunchesReadOnlyTheNewItem() throws {
        let key = LocalRuntimeAuth.keychainKey
        let current = InMemorySecretStore()
        let legacy = InMemorySecretStore(items: [key: "existing-runtime-token"])
        let firstLaunch = MigratingSecretStore(current: current, legacy: legacy)

        XCTAssertEqual(try LocalRuntimeAuth.ensureToken(in: firstLaunch), "existing-runtime-token")
        XCTAssertEqual(current.items[key], "existing-runtime-token")
        XCTAssertEqual(legacy.items[key], "existing-runtime-token")
        XCTAssertEqual(legacy.deleteCount, 0)
        XCTAssertEqual(current.reads.map(\.allowsUserInteraction), [true, false])

        let secondLaunch = MigratingSecretStore(current: current, legacy: legacy)
        XCTAssertEqual(try LocalRuntimeAuth.ensureToken(in: secondLaunch), "existing-runtime-token")
        XCTAssertEqual(legacy.reads.count, 1)
    }

    func testQuietRuntimeReadDoesNotMigrateOrWrite() {
        let current = InMemorySecretStore()
        let legacy = InMemorySecretStore(items: ["key": "old"])
        let store = MigratingSecretStore(current: current, legacy: legacy)

        XCTAssertEqual(store.read(key: "key", allowUserInteraction: false), .found("old"))
        XCTAssertTrue(current.items.isEmpty)
        XCTAssertEqual(legacy.reads.map(\.allowsUserInteraction), [false])
    }

    func testCurrentCredentialWinsOverTheRollbackCopy() {
        let current = InMemorySecretStore(items: ["key": "current"])
        let legacy = InMemorySecretStore(items: ["key": "older"])
        let store = MigratingSecretStore(current: current, legacy: legacy)

        XCTAssertEqual(store.read(key: "key", allowUserInteraction: true), .found("current"))
        XCTAssertTrue(legacy.reads.isEmpty)
        XCTAssertEqual(current.items["key"], "current")
    }

    func testFailedNewItemReadNeverFallsBackToAnOlderToken() {
        let current = InMemorySecretStore(readFailure: errSecInteractionNotAllowed)
        let legacy = InMemorySecretStore(items: ["key": "outdated"])
        let store = MigratingSecretStore(current: current, legacy: legacy)

        XCTAssertEqual(store.read(key: "key", allowUserInteraction: true), .failed(errSecInteractionNotAllowed))
        XCTAssertTrue(legacy.reads.isEmpty)
        XCTAssertEqual(legacy.items["key"], "outdated")
    }

    func testFailedLegacyReadDoesNotCreateAReplacementRuntimeToken() {
        let key = LocalRuntimeAuth.keychainKey
        let current = InMemorySecretStore()
        let legacy = InMemorySecretStore(items: [key: "existing"], readFailure: errSecAuthFailed)
        let store = MigratingSecretStore(current: current, legacy: legacy)

        XCTAssertThrowsError(try LocalRuntimeAuth.ensureToken(in: store))
        XCTAssertTrue(current.items.isEmpty)
        XCTAssertEqual(legacy.items[key], "existing")
        XCTAssertEqual(legacy.deleteCount, 0)
    }

    func testFailedMigrationWritePreservesTheLegacyToken() {
        let current = InMemorySecretStore(writeFailure: errSecAuthFailed)
        let legacy = InMemorySecretStore(items: ["key": "existing"])
        let store = MigratingSecretStore(current: current, legacy: legacy)

        XCTAssertEqual(store.read(key: "key", allowUserInteraction: true), .failed(errSecAuthFailed))
        XCTAssertTrue(current.items.isEmpty)
        XCTAssertEqual(legacy.items["key"], "existing")
        XCTAssertEqual(legacy.deleteCount, 0)
    }

    func testNewRuntimeInstallCreatesAndReusesItsOwnToken() throws {
        let current = InMemorySecretStore()
        let legacy = InMemorySecretStore()
        let store = MigratingSecretStore(current: current, legacy: legacy)
        let token = try LocalRuntimeAuth.ensureToken(in: store)

        XCTAssertEqual(token.count, 64)
        XCTAssertEqual(try LocalRuntimeAuth.ensureToken(in: store), token)
        XCTAssertTrue(legacy.items.isEmpty)
    }

    func testMigrationRequiresThePersistedItemToBeReadable() {
        let current = InMemorySecretStore(readFailureAfterWrite: errSecInteractionNotAllowed)
        let legacy = InMemorySecretStore(items: ["key": "existing"])
        let store = MigratingSecretStore(current: current, legacy: legacy)

        XCTAssertEqual(store.read(key: "key", allowUserInteraction: true), .failed(errSecInteractionNotAllowed))
        XCTAssertEqual(current.items["key"], "existing")
        XCTAssertEqual(legacy.items["key"], "existing")
        XCTAssertEqual(legacy.deleteCount, 0)
    }

    func testExplicitRuntimeResetRemovesBothItems() {
        let current = InMemorySecretStore(items: ["key": "new"])
        let legacy = InMemorySecretStore(items: ["key": "old"])
        let store = MigratingSecretStore(current: current, legacy: legacy)

        XCTAssertTrue(store.delete(key: "key", allowUserInteraction: true))
        XCTAssertEqual(store.read(key: "key", allowUserInteraction: false), .notFound)
        XCTAssertTrue(current.items.isEmpty)
        XCTAssertTrue(legacy.items.isEmpty)
    }

    /// A denied or interrupted read on an unsigned build used to erase the stored token.
    func testFailedReadLeavesTheTokenAndTheValueInMemory() {
        let store = InMemorySecretStore(items: ["apiToken": "stored"])
        let state = ConnectionState(secretStore: store)
        state.loadConnectionSecretsIfNeeded(allowUserInteraction: false)
        store.failReads(with: errSecInteractionNotAllowed)

        state.loadConnectionSecretsIfNeeded(allowUserInteraction: true)

        XCTAssertEqual(state.apiToken, "stored")
        XCTAssertFalse(state.isAPITokenUnreadable)
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
        XCTAssertTrue(state.isKeyUnreadable(for: .anthropic))
    }

    /// Each Copilot message reads the selected provider's key. After a refused read it used to
    /// read every key with prompts allowed, on every message, so a denied prompt kept coming back.
    func testCopilotMessagesReadOnlyTheSelectedKeyAndPromptOnce() {
        let store = InMemorySecretStore(readFailure: errSecAuthFailed)
        let state = CopilotSettingsState(secretStore: store)

        XCTAssertEqual(state.activeAPIKey(), "")
        XCTAssertEqual(state.activeAPIKey(), "")
        store.failReads(with: nil)
        XCTAssertEqual(state.activeAPIKey(), "")
        XCTAssertEqual(state.activeAPIKey(), "")

        // One key, whichever provider is selected. A key read once isn't read again.
        XCTAssertEqual(Set(store.reads.map(\.key)).count, 1)
        XCTAssertEqual(store.reads.map(\.allowsUserInteraction), [true, false, false])
    }

    /// After a failed read the fields are empty. Saving them as they were used to delete the
    /// stored token and key, so Apply now sends only the secrets the user edited.
    func testApplySendsOnlyTheSecretsTheUserEdited() {
        var draft = SettingsDraft(
            apiBaseURL: "http://127.0.0.1:58080",
            apiToken: "",
            copilotProvider: .openai,
            anthropicApiKey: "",
            openaiKey: "sk-stored",
            copilotModel: ""
        )
        draft.apiBaseURL = "https://immoradar.example"
        draft.copilotModel = "gpt-x"

        XCTAssertNil(draft.editedAPIToken)
        XCTAssertNil(draft.editedAnthropicKey)
        XCTAssertNil(draft.editedOpenAIKey)

        draft.apiToken = "typed"
        draft.openaiKey = ""

        XCTAssertEqual(draft.editedAPIToken, "typed")
        XCTAssertEqual(draft.editedOpenAIKey, "", "A key cleared on purpose is saved empty, which deletes it.")
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

        XCTAssertTrue(state.saveAPIToken("new"))

        XCTAssertEqual(store.items["apiToken"], "new")
        XCTAssertEqual(state.apiToken, "new")
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
        XCTAssertEqual(history[1].content, "Shown as cards in the app:\nMarket statistics")
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

        XCTAssertEqual(report.issueMessage, "The database isn’t responding.")
    }

    func testHealthyReportHasNoIssue() throws {
        let body = Data(#"{"status":"ok","checks":{"postgres":"ok","redis":"ok"}}"#.utf8)

        XCTAssertNil(try JSONDecoder().decode(HealthProbe.Report.self, from: body).issueMessage)
    }
}
