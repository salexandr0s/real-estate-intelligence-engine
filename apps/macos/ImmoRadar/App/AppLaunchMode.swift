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

    private init(root: URL, apiToken: String) {
        self.root = root
        self.apiToken = apiToken
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
        _ = try requirePath(environment["IMMORADAR_LOGS_DIRECTORY_OVERRIDE"], "logs")
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
        return Self(root: root, apiToken: token)
    }
}

struct AppLaunchPolicy {
    let mode: AppLaunchMode
    let smokeContext: IsolatedSmokeContext?

    var allowsStoredCredentials: Bool { mode == .production && smokeContext == nil }
    var allowsDuplicateAppTermination: Bool { mode == .production && smokeContext == nil }
    var allowsAutomaticFeatureLoads: Bool { mode == .production && smokeContext == nil }
    var allowsBackgroundRefresh: Bool { mode == .production && smokeContext == nil }

    func connectionToken(storedToken: () -> String?) -> String? {
        if let smokeContext { return smokeContext.apiToken }
        guard allowsStoredCredentials else { return nil }
        return storedToken()
    }
}
