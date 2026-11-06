import Foundation

enum AppLaunchMode: Equatable {
    case production
    case preview
    case test

    static var current: Self {
        resolve(environment: ProcessInfo.processInfo.environment)
    }

    static func resolve(environment: [String: String]) -> Self {
        if environment["XCTestConfigurationFilePath"] != nil {
            return .test
        }

        if environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1" {
            return .preview
        }

        return .production
    }

    var allowsInitialLaunchSideEffects: Bool {
        self == .production
    }

    var allowsBackgroundRefreshTasks: Bool {
        self == .production
    }

    var shouldRequestNotificationPermission: Bool {
        self == .production
    }
}

/// A launch by `scripts/release/smoke-test-macos-app.sh`. Everything it starts or writes stays under
/// a private root, so it can't reach the user's data, Keychain or running app. The app exits before
/// doing anything if the launch doesn't prove that.
struct IsolatedSmokeContext: Equatable {
    enum ValidationError: Error {
        case invalidContext
    }

    static let disabledFeatures = [
        "SCHEDULER_ENABLED", "SCRAPER_CANARY_ENABLED", "FEATURE_GEOCODING_ENABLED",
        "FEATURE_CROSS_SOURCE_CLUSTERING_ENABLED", "ALERTS_EMAIL_ENABLED",
        "ALERTS_WEBHOOK_ENABLED", "ALERTS_PUSH_ENABLED", "OUTREACH_ENABLED",
        "PROMETHEUS_ENABLED",
    ]

    let apiToken: String
    let apiBaseURL: URL
    let startsMonitoring: Bool

    private init(apiToken: String, apiBaseURL: URL, startsMonitoring: Bool) {
        self.apiToken = apiToken
        self.apiBaseURL = apiBaseURL
        self.startsMonitoring = startsMonitoring
    }

    static func resolve(
        environment: [String: String],
        executableURL: URL,
        bundleURL: URL,
        currentUserID: UInt,
        fileManager: FileManager = .default
    ) throws -> Self? {
        guard let requested = environment["IMMORADAR_SMOKE_TEST"] else { return nil }
        let allowedKeys = Set(disabledFeatures + [
            "HOME", "CFFIXED_USER_HOME", "TMPDIR", "PATH", "LANG", "LC_ALL", "LC_CTYPE",
            "__CF_USER_TEXT_ENCODING",
            "IMMORADAR_SMOKE_TEST", "IMMORADAR_SMOKE_ROOT", "IMMORADAR_SMOKE_BOOT_MODE",
            "IMMORADAR_SMOKE_LAUNCH_BROWSER",
            "IMMORADAR_API_BASE_URL_OVERRIDE", "IMMORADAR_RUNTIME_HOME_OVERRIDE",
            "IMMORADAR_LOGS_DIRECTORY_OVERRIDE", "IMMORADAR_LOCAL_RUNTIME_API_TOKEN",
            "IMMORADAR_POSTGRES_PORT_OVERRIDE", "IMMORADAR_REDIS_PORT_OVERRIDE",
        ])
        guard requested == "1", Set(environment.keys).isSubset(of: allowedKeys),
              disabledFeatures.allSatisfy({ environment[$0] == "false" }),
              environment["PATH"] == "/usr/bin:/bin:/usr/sbin:/sbin",
              [nil, "setup", "active"].contains(environment["IMMORADAR_SMOKE_BOOT_MODE"]),
              [nil, "1"].contains(environment["IMMORADAR_SMOKE_LAUNCH_BROWSER"]),
              let root = environment["IMMORADAR_SMOKE_ROOT"],
              let token = environment["IMMORADAR_LOCAL_RUNTIME_API_TOKEN"],
              token.hasPrefix("smoke-"), UUID(uuidString: String(token.dropFirst(6))) != nil else {
            throw ValidationError.invalidContext
        }

        guard canonicalPath(root) == root,
              (root as NSString).lastPathComponent.hasPrefix("immoradar-smoke."),
              let attributes = try? fileManager.attributesOfItem(atPath: root),
              (attributes[.ownerAccountID] as? NSNumber)?.uintValue == currentUserID,
              (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700 else {
            throw ValidationError.invalidContext
        }

        func requirePath(_ actual: String?, _ relative: String) throws {
            let expected = "\(root)/\(relative)"
            guard actual == expected, canonicalPath(expected) == expected else {
                throw ValidationError.invalidContext
            }
        }

        try requirePath(environment["HOME"], "home")
        try requirePath(environment["CFFIXED_USER_HOME"], "home")
        try requirePath(environment["TMPDIR"], "t")
        try requirePath(environment["IMMORADAR_RUNTIME_HOME_OVERRIDE"], "runtime-home")
        try requirePath(environment["IMMORADAR_LOGS_DIRECTORY_OVERRIDE"], "logs")
        try requirePath(canonicalPath(bundleURL.path), "install/ImmoRadar.app")
        try requirePath(canonicalPath(executableURL.path), "install/ImmoRadar.app/Contents/MacOS/ImmoRadar")

        let runtime = "install/ImmoRadar.app/Contents/Resources/runtime"
        let manifestPath = "\(runtime)/manifest.json"
        try requirePath("\(root)/\(manifestPath)", manifestPath)
        guard let data = fileManager.contents(atPath: "\(root)/\(manifestPath)"),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              manifest["version"] as? Int == 1,
              manifest["nodeExecutable"] as? String == "bin/node",
              manifest["artifactsDirectory"] as? String == "artifacts",
              let scripts = manifest["scripts"] as? [String: String],
              scripts == [
                  "postgres": "scripts/start-postgres.sh",
                  "redis": "scripts/start-redis.sh",
                  "migrate": "scripts/run-migrations.sh",
                  "watchdog": "scripts/engine-watchdog.sh",
              ] else {
            throw ValidationError.invalidContext
        }
        for relative in ["bin/node", "infra/postgres/bin/postgres", "infra/redis/bin/redis-server",
                         "apps/api/dist/main.js", "apps/worker-processing/dist/main.js", "apps/worker-scraper/dist/main.js"] + Array(scripts.values) {
            try requirePath("\(root)/\(runtime)/\(relative)", "\(runtime)/\(relative)")
        }
        if let browsers = manifest["playwrightBrowsersPath"] as? String, browsers != "playwright-browsers" {
            throw ValidationError.invalidContext
        }

        guard let api = environment["IMMORADAR_API_BASE_URL_OVERRIDE"],
              let components = URLComponents(string: api), components.scheme == "http",
              components.host == "127.0.0.1", components.user == nil, components.password == nil,
              components.path.isEmpty, components.query == nil, components.fragment == nil,
              let apiPort = components.port,
              let postgresPort = Int(environment["IMMORADAR_POSTGRES_PORT_OVERRIDE"] ?? ""),
              let redisPort = Int(environment["IMMORADAR_REDIS_PORT_OVERRIDE"] ?? ""),
              [apiPort, postgresPort, redisPort].allSatisfy({ (1024...65535).contains($0) }),
              Set([apiPort, postgresPort, redisPort]).count == 3,
              let apiBaseURL = components.url else {
            throw ValidationError.invalidContext
        }
        return Self(
            apiToken: token,
            apiBaseURL: apiBaseURL,
            startsMonitoring: environment["IMMORADAR_SMOKE_BOOT_MODE"] == "active"
        )
    }

    /// `URL.resolvingSymlinksInPath` and `standardizedFileURL` both strip `/private`, so neither can
    /// tell a canonical path from a link.
    private static func canonicalPath(_ path: String) -> String? {
        guard let resolved = realpath(path, nil) else { return nil }
        defer { free(resolved) }
        return String(cString: resolved)
    }
}

struct AppLaunchPolicy {
    let mode: AppLaunchMode
    let smokeContext: IsolatedSmokeContext?
    private let smokeRequested: Bool

    init(mode: AppLaunchMode, smokeContext: IsolatedSmokeContext?, smokeRequested: Bool = ProcessInfo.processInfo.environment["IMMORADAR_SMOKE_TEST"] != nil) {
        self.mode = mode
        self.smokeContext = smokeContext
        self.smokeRequested = smokeRequested
    }

    var requiresSmokeBoundary: Bool { smokeContext != nil || smokeRequested }
    var allowsStoredCredentials: Bool { mode == .production && !requiresSmokeBoundary }
    var allowsStoredSettingsChanges: Bool { mode == .production && !requiresSmokeBoundary }
    /// Taking the instance lock, starting the engine and signaling its processes. A validated smoke
    /// run does these under its own root, so it never meets the user's app. Tests and previews run
    /// inside the real app's bundle ID, so they must never do them.
    var allowsEngineEffects: Bool { mode == .production && (smokeContext != nil || !smokeRequested) }
    var allowsAutomaticFeatureLoads: Bool { mode == .production && !requiresSmokeBoundary }
    var allowsBackgroundRefresh: Bool { mode == .production && !requiresSmokeBoundary }

    func connectionToken(storedToken: () -> String?) -> String? {
        if let smokeContext { return smokeContext.apiToken }
        guard allowsStoredCredentials else { return nil }
        return storedToken()
    }
}
