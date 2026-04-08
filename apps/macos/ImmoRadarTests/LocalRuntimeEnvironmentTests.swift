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

    @MainActor
    func testNodeExecutableCandidatesPreferEnvironmentOverride() {
        let root = URL(fileURLWithPath: "/tmp/immoradar-repo", isDirectory: true)
        let override = "/tmp/custom-node"

        let candidates = LocalRuntimeService.nodeExecutableCandidates(
            under: root,
            environment: [
                "IMMORADAR_NODE_EXECUTABLE": override,
                "PATH": "/usr/bin:/bin",
            ],
            homeDirectory: URL(fileURLWithPath: "/Users/test", isDirectory: true)
        )

        XCTAssertEqual(candidates.first?.path, override)
    }

    @MainActor
    func testNodeExecutableCandidatesIncludeCommonHomebrewPathWithoutPATH() {
        let root = URL(fileURLWithPath: "/tmp/immoradar-repo", isDirectory: true)

        let candidates = LocalRuntimeService.nodeExecutableCandidates(
            under: root,
            environment: [:],
            homeDirectory: URL(fileURLWithPath: "/Users/test", isDirectory: true)
        )

        XCTAssertTrue(candidates.contains(URL(fileURLWithPath: "/opt/homebrew/bin/node")))
    }

    @MainActor
    func testDetectBundledComponentPIDsFindsBundledRuntimeProcesses() {
        let runtimeRoot = URL(
            fileURLWithPath: "/Applications/ImmoRadar.app/Contents/Resources/runtime",
            isDirectory: true
        )
        let runtimeHome = URL(
            fileURLWithPath: "/Users/test/Library/Application Support/ImmoRadar/runtime",
            isDirectory: true
        )
        let processList = """
          301 \(runtimeRoot.path)/infra/postgres/bin/postgres -D \(runtimeHome.path)/postgres/data -h 127.0.0.1 -p 55432
          302 \(runtimeRoot.path)/infra/redis/bin/redis-server 127.0.0.1:56379
          303 \(runtimeRoot.path)/bin/node \(runtimeRoot.path)/apps/api/dist/main.js
          304 \(runtimeRoot.path)/bin/node \(runtimeRoot.path)/apps/worker-processing/dist/main.js
          305 \(runtimeRoot.path)/bin/node \(runtimeRoot.path)/apps/worker-scraper/dist/main.js
        """

        let detected = LocalRuntimeService.detectBundledComponentPIDs(
            processListOutput: processList,
            runtimeRoot: runtimeRoot,
            runtimeHome: runtimeHome,
            redisPort: 56379
        )

        XCTAssertEqual(detected[.postgres], 301)
        XCTAssertEqual(detected[.redis], 302)
        XCTAssertEqual(detected[.api], 303)
        XCTAssertEqual(detected[.processing], 304)
        XCTAssertEqual(detected[.scraper], 305)
    }

    @MainActor
    func testDetectBundledComponentPIDsIgnoresForeignProcesses() {
        let runtimeRoot = URL(
            fileURLWithPath: "/Applications/ImmoRadar.app/Contents/Resources/runtime",
            isDirectory: true
        )
        let runtimeHome = URL(
            fileURLWithPath: "/Users/test/Library/Application Support/ImmoRadar/runtime",
            isDirectory: true
        )
        let processList = """
          401 /opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:56379
          402 /opt/homebrew/bin/node /another/runtime/apps/api/dist/main.js
        """

        let detected = LocalRuntimeService.detectBundledComponentPIDs(
            processListOutput: processList,
            runtimeRoot: runtimeRoot,
            runtimeHome: runtimeHome,
            redisPort: 56379
        )

        XCTAssertTrue(detected.isEmpty)
    }
}
