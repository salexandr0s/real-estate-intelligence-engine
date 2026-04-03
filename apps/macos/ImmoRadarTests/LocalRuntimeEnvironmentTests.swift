import XCTest
@testable import ImmoRadar

final class LocalRuntimeEnvironmentTests: XCTestCase {
    @MainActor
    func testRepoRootCandidatesHonorEnvironmentOverride() {
        let override = "/tmp/immoradar-repo-override"
        let candidates = LocalRuntimeService.runtimeRootCandidates(
            currentDirectoryPath: "/tmp",
            bundleURL: URL(fileURLWithPath: "/Applications/ImmoRadar.app", isDirectory: true),
            environment: ["IMMORADAR_REPO_ROOT_OVERRIDE": override]
        )

        XCTAssertEqual(candidates.first?.path, override)
    }

    @MainActor
    func testFindRepoRuntimeRootFallsBackToDebugSourceRoot() throws {
        let discovered = try LocalRuntimeService.findRepoRuntimeRoot(
            currentDirectoryPath: "/tmp",
            bundleURL: URL(fileURLWithPath: "/Applications/ImmoRadar.app", isDirectory: true),
            environment: [:]
        )

        XCTAssertTrue(LocalRuntimeService.hasRepoWorkspaceLayout(at: discovered))
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: discovered.appendingPathComponent("apps/api/package.json").path
            )
        )
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: discovered.appendingPathComponent("apps/worker-processing/package.json").path
            )
        )
    }

    @MainActor
    func testFindRepoRuntimeRootAcceptsWorkspaceWithoutBuiltArtifacts() throws {
        let tempRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempRoot) }

        let markerPaths = [
            "package.json",
            "apps/api/package.json",
            "apps/worker-processing/package.json",
            "apps/worker-scraper/package.json",
        ]

        for relativePath in markerPaths {
            let fileURL = tempRoot.appendingPathComponent(relativePath)
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            FileManager.default.createFile(atPath: fileURL.path, contents: Data("{}".utf8))
        }

        let discovered = try LocalRuntimeService.findRepoRuntimeRoot(
            currentDirectoryPath: "/tmp",
            bundleURL: URL(fileURLWithPath: "/Applications/ImmoRadar.app", isDirectory: true),
            environment: ["IMMORADAR_REPO_ROOT_OVERRIDE": tempRoot.path]
        )

        XCTAssertEqual(discovered.standardizedFileURL, tempRoot.standardizedFileURL)
        XCTAssertFalse(LocalRuntimeService.hasRepoRuntimeArtifacts(at: discovered))
    }

    func testLocalRuntimeAuthPrefersEnvironmentOverrideToken() throws {
        let token = "smoke-test-token"
        setenv("IMMORADAR_LOCAL_RUNTIME_API_TOKEN", token, 1)
        defer { unsetenv("IMMORADAR_LOCAL_RUNTIME_API_TOKEN") }

        XCTAssertEqual(LocalRuntimeAuth.loadToken(allowUserInteraction: false), token)
        XCTAssertEqual(try LocalRuntimeAuth.ensureToken(), token)
    }

    @MainActor
    func testAppStatePrefersAPIBaseURLEnvironmentOverride() {
        let override = "http://127.0.0.1:18080"
        setenv("IMMORADAR_API_BASE_URL_OVERRIDE", override, 1)
        defer { unsetenv("IMMORADAR_API_BASE_URL_OVERRIDE") }

        let appState = AppState()

        XCTAssertEqual(appState.apiBaseURL, override)
    }

    @MainActor
    func testLocalRuntimeServiceUsesFilesystemOverrides() {
        setenv("IMMORADAR_RUNTIME_HOME_OVERRIDE", "/tmp/immoradar-runtime-home-test", 1)
        setenv("IMMORADAR_LOGS_DIRECTORY_OVERRIDE", "/tmp/immoradar-logs-test", 1)
        defer {
            unsetenv("IMMORADAR_RUNTIME_HOME_OVERRIDE")
            unsetenv("IMMORADAR_LOGS_DIRECTORY_OVERRIDE")
        }

        let runtimeHomePath = LocalRuntimeService.runtimeHomeURL.path
        let logsDirectoryPath = LocalRuntimeService.logsDirectoryURL.path

        XCTAssertEqual(runtimeHomePath, "/tmp/immoradar-runtime-home-test")
        XCTAssertEqual(logsDirectoryPath, "/tmp/immoradar-logs-test")
    }

    @MainActor
    func testDetectRepoComponentPIDsFindsRepoProcessesFromProcessList() {
        let root = URL(fileURLWithPath: "/tmp/immoradar-repo", isDirectory: true)
        let processList = """
          101 /opt/homebrew/bin/node \(root.path)/apps/api/dist/main.js
          102 /opt/homebrew/bin/node \(root.path)/apps/worker-processing/dist/main.js
          103 /opt/homebrew/bin/node \(root.path)/apps/worker-scraper/dist/main.js
          201 /opt/homebrew/bin/node /another/repo/apps/api/dist/main.js
        """

        let detected = LocalRuntimeService.detectRepoComponentPIDs(
            processListOutput: processList,
            runtimeRoot: root
        )

        XCTAssertEqual(detected[.api], 101)
        XCTAssertEqual(detected[.processing], 102)
        XCTAssertEqual(detected[.scraper], 103)
    }
}
