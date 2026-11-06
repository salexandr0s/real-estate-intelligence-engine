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

struct IsolatedSmokeContext: Equatable {
    let root: URL
    let apiToken: String
    let bundleURL: URL
    let runtimeRoot: URL
    let nodeExecutableURL: URL
    let runtimeHome: URL
    let logsDirectory: URL
    let apiBaseURL: URL
    let postgresPort: Int
    let redisPort: Int
    let ownerUserID: UInt
    let environment: [String: String]
    /// Captured for configuration consistency only. These candidate bytes are
    /// not an authenticated expected inventory or permission to execute them.
    let manifestData: Data

    private init(
        root: URL, apiToken: String, bundleURL: URL, runtimeRoot: URL,
        runtimeHome: URL, logsDirectory: URL, apiBaseURL: URL,
        postgresPort: Int, redisPort: Int, ownerUserID: UInt,
        environment: [String: String], manifestData: Data
    ) {
        self.root = root
        self.apiToken = apiToken
        self.bundleURL = bundleURL
        self.runtimeRoot = runtimeRoot
        self.nodeExecutableURL = runtimeRoot.appendingPathComponent("bin/node")
        self.runtimeHome = runtimeHome
        self.logsDirectory = logsDirectory
        self.apiBaseURL = apiBaseURL
        self.postgresPort = postgresPort
        self.redisPort = redisPort
        self.ownerUserID = ownerUserID
        self.environment = environment
        self.manifestData = manifestData
    }

    enum ValidationError: Error {
        case invalidContext
    }

    static let disabledFeatures = [
        "SCHEDULER_ENABLED", "SCRAPER_CANARY_ENABLED", "FEATURE_GEOCODING_ENABLED",
        "FEATURE_CROSS_SOURCE_CLUSTERING_ENABLED", "ALERTS_EMAIL_ENABLED",
        "ALERTS_WEBHOOK_ENABLED", "ALERTS_PUSH_ENABLED", "OUTREACH_ENABLED",
        "OTEL_ENABLED", "PROMETHEUS_ENABLED",
    ]

    static func resolve(
        environment: [String: String],
        executableURL: URL,
        bundleURL: URL,
        currentUserID: UInt,
        fileManager: FileManager = .default
    ) throws -> Self? {
        guard let requested = environment["IMMORADAR_SMOKE_TEST"] else { return nil }
        let allowedKeys = Set(disabledFeatures + [
            "HOME", "TMPDIR", "PATH", "LANG", "LC_ALL", "LC_CTYPE",
            "IMMORADAR_SMOKE_TEST", "IMMORADAR_SMOKE_ROOT",
            "IMMORADAR_API_BASE_URL_OVERRIDE", "IMMORADAR_RUNTIME_HOME_OVERRIDE",
            "IMMORADAR_LOGS_DIRECTORY_OVERRIDE", "IMMORADAR_LOCAL_RUNTIME_API_TOKEN",
            "IMMORADAR_POSTGRES_PORT_OVERRIDE", "IMMORADAR_REDIS_PORT_OVERRIDE",
        ])
        guard requested == "1", Set(environment.keys).isSubset(of: allowedKeys),
              disabledFeatures.allSatisfy({ environment[$0] == "false" }),
              environment["PATH"] == "/usr/bin:/bin:/usr/sbin:/sbin",
              let rootPath = environment["IMMORADAR_SMOKE_ROOT"], rootPath.hasPrefix("/"),
              let token = environment["IMMORADAR_LOCAL_RUNTIME_API_TOKEN"],
              token.hasPrefix("smoke-"), UUID(uuidString: String(token.dropFirst(6))) != nil else {
            throw ValidationError.invalidContext
        }

        let root = URL(fileURLWithPath: rootPath, isDirectory: true).standardizedFileURL
        guard root.resolvingSymlinksInPath() == root,
              root.lastPathComponent.hasPrefix("immoradar-smoke."),
              let attributes = try? fileManager.attributesOfItem(atPath: root.path),
              (attributes[.ownerAccountID] as? NSNumber)?.uintValue == currentUserID,
              (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700 else {
            throw ValidationError.invalidContext
        }

        func requirePath(_ actual: String?, _ relative: String, directory: Bool = true) throws -> URL {
            let expected = root.appendingPathComponent(relative, isDirectory: directory).standardizedFileURL
            guard actual == expected.path, expected.resolvingSymlinksInPath() == expected,
                  fileManager.fileExists(atPath: expected.path) else {
                throw ValidationError.invalidContext
            }
            return expected
        }

        _ = try requirePath(environment["HOME"], "home")
        _ = try requirePath(environment["TMPDIR"], "tmp")
        let runtimeHome = try requirePath(environment["IMMORADAR_RUNTIME_HOME_OVERRIDE"], "runtime-home")
        let logsDirectory = try requirePath(environment["IMMORADAR_LOGS_DIRECTORY_OVERRIDE"], "logs")
        guard try fileManager.contentsOfDirectory(atPath: runtimeHome.path).isEmpty else {
            throw ValidationError.invalidContext
        }
        let app = try requirePath(bundleURL.standardizedFileURL.path, "install/ImmoRadar.app")
        _ = try requirePath(executableURL.standardizedFileURL.path, "install/ImmoRadar.app/Contents/MacOS/ImmoRadar", directory: false)
        let runtime = app.appendingPathComponent("Contents/Resources/runtime", isDirectory: true)
        let manifestURL = runtime.appendingPathComponent("manifest.json")
        guard runtime.resolvingSymlinksInPath() == runtime,
              manifestURL.resolvingSymlinksInPath() == manifestURL,
              let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              manifest["version"] as? Int == 1,
              manifest["nodeExecutable"] as? String == "bin/node",
              manifest["artifactsDirectory"] as? String == "artifacts",
              let scripts = manifest["scripts"] as? [String: String],
              scripts == ["postgres": "scripts/start-postgres.sh", "redis": "scripts/start-redis.sh", "migrate": "scripts/run-migrations.sh"] else {
            throw ValidationError.invalidContext
        }
        for relative in ["bin/node", "infra/postgres/bin/postgres", "infra/redis/bin/redis-server",
                         "apps/api/dist/main.js", "apps/worker-processing/dist/main.js", "apps/worker-scraper/dist/main.js"] + Array(scripts.values) {
            let item = runtime.appendingPathComponent(relative)
            guard item.resolvingSymlinksInPath() == item, fileManager.fileExists(atPath: item.path) else {
                throw ValidationError.invalidContext
            }
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
              Set([apiPort, postgresPort, redisPort]).count == 3 else {
            throw ValidationError.invalidContext
        }
        guard let apiBaseURL = components.url else { throw ValidationError.invalidContext }
        return Self(root: root, apiToken: token, bundleURL: app, runtimeRoot: runtime,
                    runtimeHome: runtimeHome, logsDirectory: logsDirectory, apiBaseURL: apiBaseURL,
                    postgresPort: postgresPort, redisPort: redisPort, ownerUserID: currentUserID,
                    environment: environment, manifestData: data)
    }
}

/// Until an authenticated receipt capability AND fresh native identity/argv
/// adapters are integrated and independently reviewed, every smoke effect is
/// refused. There is deliberately no boolean/setter that self-attests a bridge
/// as ready. The phase2A pure comparison model alone is not native authority.
struct SmokeRuntimeAccessPolicy {
    enum Operation: CaseIterable {
        case launch, stop, appExit, reset, status, diagnostics, discovery, registry
        case signal, logAccess, network, retry, completion, lateCallback, repoFallback, credentials, readiness
    }

    enum Refusal: Equatable {
        case nonProductionLaunch
        case missingContext
        case missingAuthenticatedAndNativeBridges
    }

    let requiresSmokeBoundary: Bool
    private let contextProvided: Bool
    private let launchMode: AppLaunchMode
    private(set) var refusal: Refusal?
    private(set) var firstRefusedOperation: Operation?

    init(contextProvided: Bool, smokeRequested: Bool, launchMode: AppLaunchMode = .production) {
        self.contextProvided = contextProvided
        self.requiresSmokeBoundary = contextProvided || smokeRequested
        self.launchMode = launchMode
    }

    mutating func permitsProductionOperation(_ operation: Operation) -> Bool {
        guard requiresSmokeBoundary || launchMode != .production else { return true }
        if refusal == nil {
            refusal = launchMode != .production ? .nonProductionLaunch
                : contextProvided ? .missingAuthenticatedAndNativeBridges : .missingContext
            firstRefusedOperation = operation
        }
        return false
    }

    var failureMessage: String? {
        switch refusal {
        case .nonProductionLaunch:
            return "Runtime side effects are disabled for tests and previews."
        case .missingContext:
            return "Isolated smoke was requested without a validated task context."
        case .missingAuthenticatedAndNativeBridges:
            return "Isolated smoke is blocked: the authenticated artifact receipt and native process identity bridges are not installed."
        case nil:
            return nil
        }
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
    /// A validated smoke run holds the lock under its own root, so it never meets the user's app.
    var enforcesSingleInstance: Bool { mode == .production && (smokeContext != nil || !smokeRequested) }
    var allowsAutomaticFeatureLoads: Bool { mode == .production && !requiresSmokeBoundary }
    var allowsBackgroundRefresh: Bool { mode == .production && !requiresSmokeBoundary }

    func connectionToken(storedToken: () -> String?) -> String? {
        if let smokeContext { return smokeContext.apiToken }
        guard allowsStoredCredentials else { return nil }
        return storedToken()
    }
}
