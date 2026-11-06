import Foundation
#if !IMMORADAR_POLICY_PROOF
import XCTest
@testable import ImmoRadar

final class AppLaunchModeTests: XCTestCase {
    func testSmokeContextAndCredentialPoliciesWithoutSideEffects() throws {
        XCTAssertFalse(try SmokePolicyProof.run().isEmpty)
    }
    func testResolvePrefersXCTestEnvironment() {
        let environment = [
            "XCTestConfigurationFilePath": "/tmp/test.xctestconfiguration",
            "XCODE_RUNNING_FOR_PREVIEWS": "1",
        ]

        XCTAssertEqual(AppLaunchMode.resolve(environment: environment), .test)
    }

    func testResolveRecognizesPreviewEnvironment() {
        XCTAssertEqual(
            AppLaunchMode.resolve(environment: ["XCODE_RUNNING_FOR_PREVIEWS": "1"]),
            .preview
        )
    }

    @MainActor
    func testTestLaunchSkipsInitialSideEffectsAndBackgroundRefresh() async {
        let appState = AppState(launchMode: .test)

        await appState.performInitialLaunchIfNeeded()

        XCTAssertEqual(appState.bundledLaunchExperienceState, .ready)
        XCTAssertFalse(appState.hasActiveBackgroundRefreshTasks)
    }

    @MainActor
    func testTestLaunchDisablesAutomaticFeatureLoads() {
        let appState = AppState(launchMode: .test)

        XCTAssertFalse(appState.allowsAutomaticFeatureLoads)
    }
}
#endif

// This same proof can be compiled with AppLaunchMode.swift alone. It must not
// import the application, execute a bundle, inspect processes or call Keychain.
enum SmokePolicyProof {
    struct Failure: Error { let check: String }

    static func run() throws -> [String] {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("immoradar-smoke.\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? fm.removeItem(at: root) }
        let app = root.appendingPathComponent("install/ImmoRadar.app", isDirectory: true)
        let executable = app.appendingPathComponent("Contents/MacOS/ImmoRadar")
        let runtime = app.appendingPathComponent("Contents/Resources/runtime", isDirectory: true)
        let manifestURL = runtime.appendingPathComponent("manifest.json")
        let scriptPaths = ["postgres": "scripts/start-postgres.sh", "redis": "scripts/start-redis.sh", "migrate": "scripts/run-migrations.sh"]
        for relative in ["home", "tmp", "runtime-home", "logs"] {
            try fm.createDirectory(at: root.appendingPathComponent(relative), withIntermediateDirectories: true)
        }
        for file in [executable] + (["bin/node", "infra/postgres/bin/postgres", "infra/redis/bin/redis-server",
                                    "apps/api/dist/main.js", "apps/worker-processing/dist/main.js", "apps/worker-scraper/dist/main.js"] + Array(scriptPaths.values)).map({ runtime.appendingPathComponent($0) }) {
            try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data().write(to: file)
        }
        let manifestData = try JSONSerialization.data(withJSONObject: [
            "version": 1, "nodeExecutable": "bin/node", "artifactsDirectory": "artifacts", "scripts": scriptPaths,
        ])
        try manifestData.write(to: manifestURL)
        let uid = (try fm.attributesOfItem(atPath: root.path)[.ownerAccountID] as! NSNumber).uintValue
        var environment = [
            "HOME": root.appendingPathComponent("home").path,
            "TMPDIR": root.appendingPathComponent("tmp").path,
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "IMMORADAR_SMOKE_TEST": "1",
            "IMMORADAR_SMOKE_ROOT": root.path,
            "IMMORADAR_RUNTIME_HOME_OVERRIDE": root.appendingPathComponent("runtime-home").path,
            "IMMORADAR_LOGS_DIRECTORY_OVERRIDE": root.appendingPathComponent("logs").path,
            "IMMORADAR_API_BASE_URL_OVERRIDE": "http://127.0.0.1:49101",
            "IMMORADAR_POSTGRES_PORT_OVERRIDE": "49102", "IMMORADAR_REDIS_PORT_OVERRIDE": "49103",
            "IMMORADAR_LOCAL_RUNTIME_API_TOKEN": "smoke-\(UUID().uuidString)",
        ]
        for key in IsolatedSmokeContext.disabledFeatures { environment[key] = "false" }
        var passed: [String] = []
        func check(_ name: String, _ condition: Bool) throws {
            guard condition else { throw Failure(check: name) }
            passed.append(name)
        }
        func resolve(_ input: [String: String]) throws -> IsolatedSmokeContext? {
            try IsolatedSmokeContext.resolve(environment: input, executableURL: executable, bundleURL: app, currentUserID: uid)
        }
        func reject(_ name: String, _ input: [String: String]) throws {
            do {
                _ = try resolve(input)
                throw Failure(check: name)
            } catch is IsolatedSmokeContext.ValidationError {
                passed.append(name)
            }
        }

        try check("normal launch has no smoke context", try resolve([:]) == nil)
        let context = try resolve(environment)
        try check("valid private context accepted", context != nil)
        var reads = 0
        let smoke = AppLaunchPolicy(mode: .production, smokeContext: context)
        let token = smoke.connectionToken { reads += 1; return "must-not-load" }
        try check("smoke token avoids stored loader", reads == 0 && token == environment["IMMORADAR_LOCAL_RUNTIME_API_TOKEN"])
        try check("smoke holds its own lock and disables feature refresh", smoke.enforcesSingleInstance && !smoke.allowsAutomaticFeatureLoads && !smoke.allowsBackgroundRefresh && !smoke.allowsStoredCredentials)
        for mode in [AppLaunchMode.test, .preview] {
            let policy = AppLaunchPolicy(mode: mode, smokeContext: nil)
            let token = policy.connectionToken { reads += 1; return "must-not-load" }
            try check("\(mode) skips credentials and the instance lock", token == nil && reads == 0 && !policy.enforcesSingleInstance && !policy.allowsStoredCredentials && !policy.allowsAutomaticFeatureLoads && !policy.allowsBackgroundRefresh)
        }
        let unvalidated = AppLaunchPolicy(mode: .production, smokeContext: nil, smokeRequested: true)
        try check("unvalidated smoke takes no lock", !unvalidated.enforcesSingleInstance)
        let production = AppLaunchPolicy(mode: .production, smokeContext: nil, smokeRequested: false)
        let productionToken = production.connectionToken { reads += 1; return "synthetic-stored-token" }
        try check("normal production policy retained", reads == 1 && productionToken == "synthetic-stored-token" && production.enforcesSingleInstance && production.allowsStoredCredentials && production.allowsAutomaticFeatureLoads && production.allowsBackgroundRefresh)

        for (name, key, value) in [
            ("invalid smoke flag rejected", "IMMORADAR_SMOKE_TEST", "0"),
            ("missing root rejected", "IMMORADAR_SMOKE_ROOT", ""),
            ("foreign home rejected", "HOME", "/Users/not-the-test-home"),
            ("missing token rejected", "IMMORADAR_LOCAL_RUNTIME_API_TOKEN", ""),
            ("inherited credentials rejected", "OPENAI_API_KEY", "synthetic-only"),
            ("enabled scheduler rejected", "SCHEDULER_ENABLED", "true"),
            ("remote API rejected", "IMMORADAR_API_BASE_URL_OVERRIDE", "https://example.invalid:49101"),
            ("colliding ports rejected", "IMMORADAR_REDIS_PORT_OVERRIDE", "49102"),
        ] {
            var invalid = environment
            invalid[key] = value
            try reject(name, invalid)
        }
        let stale = root.appendingPathComponent("runtime-home/stale-registry")
        try Data().write(to: stale)
        try reject("existing runtime home rejected", environment)
        try fm.removeItem(at: stale)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: root.path)
        try reject("non-private root rejected", environment)
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        do {
            _ = try IsolatedSmokeContext.resolve(environment: environment, executableURL: executable, bundleURL: app, currentUserID: uid + 1)
            throw Failure(check: "foreign owner rejected")
        } catch is IsolatedSmokeContext.ValidationError { passed.append("foreign owner rejected") }
        do {
            _ = try IsolatedSmokeContext.resolve(environment: environment, executableURL: URL(fileURLWithPath: "/Applications/ImmoRadar.app/Contents/MacOS/ImmoRadar"), bundleURL: app, currentUserID: uid)
            throw Failure(check: "installed executable rejected")
        } catch is IsolatedSmokeContext.ValidationError { passed.append("installed executable rejected") }
        try fm.removeItem(at: manifestURL)
        try reject("missing manifest rejected", environment)
        let escapedManifest = root.appendingPathComponent("outside-manifest.json")
        try manifestData.write(to: escapedManifest)
        try fm.createSymbolicLink(at: manifestURL, withDestinationURL: escapedManifest)
        try reject("manifest symlink rejected", environment)
        try fm.removeItem(at: manifestURL)
        try manifestData.write(to: manifestURL)
        let node = runtime.appendingPathComponent("bin/node")
        try fm.removeItem(at: node)
        try fm.createSymbolicLink(at: node, withDestinationURL: executable)
        try reject("runtime executable symlink rejected", environment)
        return passed
    }
}
