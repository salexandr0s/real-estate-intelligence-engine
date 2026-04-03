import Foundation
import Darwin

enum LocalRuntimeAuth {
    static let keychainKey = "localRuntimeApiToken"

    private static var environmentOverrideToken: String? {
        guard let raw = ProcessInfo.processInfo.environment["IMMORADAR_LOCAL_RUNTIME_API_TOKEN"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !raw.isEmpty else {
            return nil
        }

        return raw
    }

    static func loadToken(allowUserInteraction: Bool = true) -> String? {
        if let environmentOverrideToken {
            return environmentOverrideToken
        }

        let token = KeychainHelper.get(
            key: keychainKey,
            allowUserInteraction: allowUserInteraction
        )?.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let token, !token.isEmpty else { return nil }
        return token
    }

    static func ensureToken() throws -> String {
        if let environmentOverrideToken {
            return environmentOverrideToken
        }

        if let existing = loadToken() {
            return existing
        }

        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max) }
        let token = bytes.map { String(format: "%02x", $0) }.joined()
        try KeychainHelper.set(key: keychainKey, value: token)
        return token
    }

    static func resetToken() {
        guard environmentOverrideToken == nil else { return }
        _ = KeychainHelper.delete(key: keychainKey)
    }

    static func preferredToken(
        for apiBaseURL: String,
        userToken: String?,
        allowUserInteraction: Bool = true
    ) -> String? {
        if isLoopbackBaseURL(apiBaseURL),
           let localToken = loadToken(allowUserInteraction: allowUserInteraction) {
            return localToken
        }

        guard let userToken else { return nil }
        let normalized = userToken.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }

    static func isLoopbackBaseURL(_ apiBaseURL: String) -> Bool {
        guard let url = URL(string: apiBaseURL),
              let host = url.host?.lowercased() else {
            return false
        }

        return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].contains(host)
    }
}

@MainActor @Observable
final class LocalRuntimeService {
    static weak var sharedInstance: LocalRuntimeService?

    enum State: Equatable {
        case stopped
        case starting
        case running
        case stopping
        case unavailable(String)
        case failed(String)

        var failureMessage: String? {
            switch self {
            case .unavailable(let message), .failed(let message):
                return message
            case .stopped, .starting, .running, .stopping:
                return nil
            }
        }

        var title: String {
            switch self {
            case .stopped:
                return "Background engine stopped"
            case .starting:
                return "Starting background engine…"
            case .running:
                return "Background engine running"
            case .stopping:
                return "Stopping background engine…"
            case .unavailable:
                return "Background engine unavailable"
            case .failed:
                return "Background engine needs attention"
            }
        }

        var detail: String {
            switch self {
            case .stopped:
                return "The local database, queue, API, and scraper workers are idle."
            case .starting:
                return "Bootstrapping the local runtime and starting services."
            case .running:
                return "The bundled local stack is active and storing data on this Mac."
            case .stopping:
                return "Stopping the local runtime and workers."
            case .unavailable(let message), .failed(let message):
                return message
            }
        }
    }


    enum BootMode: String, Equatable {
        case setup
        case active

        var displayName: String {
            switch self {
            case .setup:
                return "Setup"
            case .active:
                return "Monitoring Active"
            }
        }
    }

    enum StartPolicy: Equatable {
        case ifNeeded
        case forceRestart
    }

    struct DiagnosticsSummary: Equatable {
        let runtimeDescription: String
        let runtimeVersion: String?
        let storagePath: String
        let logsPath: String
        let startupDiagnosticsPath: String
        let lastErrorMessage: String?
        let lastFailureCode: String?
    }

    struct ComponentStatus: Identifiable, Hashable {
        enum Kind: String {
            case postgres = "Postgres"
            case redis = "Redis"
            case api = "API"
            case processing = "Processing"
            case scraper = "Scraper"
        }

        let kind: Kind
        var isRunning: Bool
        var pid: Int32?

        var id: Kind { kind }
    }

    struct ProgressStatus: Equatable {
        let title: String
        let detail: String
        let fractionCompleted: Double?
    }

    private enum StartupStep: String, Codable {
        case preparingStorage
        case bootstrappingRepoRuntime
        case startingPostgres
        case waitingForPostgres
        case startingRedis
        case waitingForRedis
        case applyingMigrations
        case startingAPI
        case waitingForAPI
        case startingProcessingWorker
        case startingScraperWorker
        case verifyingServices
    }

    private enum StartupDiagnosticsStatus: String, Codable {
        case idle
        case starting
        case retrying
        case running
        case failed
        case stopping
        case stopped
    }

    private struct StartupDiagnosticsComponentSnapshot: Codable {
        let component: String
        let isRunning: Bool
        let pid: Int32?
    }

    private struct StartupDiagnosticsPayload: Codable {
        let attemptID: Int?
        let bootMode: String?
        let runtimeDescription: String?
        let runtimeVersion: String?
        let storagePath: String
        let logsPath: String
        let status: String
        let step: String?
        let retryCount: Int
        let maxRetryCount: Int
        let failureCode: String?
        let failureMessage: String?
        let logFileName: String?
        let startedAt: Date?
        let updatedAt: Date
        let components: [StartupDiagnosticsComponentSnapshot]
    }

    private struct StartupFailure: Error, LocalizedError, Equatable {
        enum Code: String, Codable {
            case invalidBaseURL
            case nonLocalBaseURL
            case runtimeArtifactsMissing
            case manifestMissing
            case nodeExecutableMissing
            case repoBootstrapToolMissing
            case repoBootstrapDependenciesMissing
            case repoBootstrapFailed
            case portInUse
            case postgresExitedBeforeReady
            case postgresStartupTimedOut
            case redisExitedBeforeReady
            case redisStartupTimedOut
            case migrationsDatabaseUnavailable
            case migrationsFailed
            case migrationsTimedOut
            case apiExitedBeforeHealthy
            case apiStartupTimedOut
            case componentExitedUnexpectedly
        }

        let code: Code
        let message: String
        let step: StartupStep?
        let logFileName: String?
        let component: Component?
        let exitCode: Int32?
        let isTransient: Bool

        var errorDescription: String? { message }
    }

    private static let repoRuntimeArtifactRelativePaths = [
        "apps/api/dist/main.js",
        "apps/worker-processing/dist/main.js",
        "apps/worker-scraper/dist/main.js",
    ]

    private static let repoWorkspaceMarkerRelativePaths = [
        "package.json",
        "apps/api/package.json",
        "apps/worker-processing/package.json",
        "apps/worker-scraper/package.json",
    ]

    private static let repoBootstrapLogFileName = "runtime-bootstrap.log"

    private static let repoBootstrapTurboScriptRelativePath = "node_modules/turbo/bin/turbo"

    var state: State = .stopped
    var progressStatus: ProgressStatus?
    var componentStatuses: [ComponentStatus] = Component.allCases.map {
        ComponentStatus(kind: $0.statusKind, isRunning: false, pid: nil)
    }
    var activeBootMode: BootMode?
    var runtimeDescription: String?
    var runtimeVersion: String?
    private var lastStartupFailure: StartupFailure?
    private var activeStartupAttemptID: Int?
    private var nextStartupAttemptID: Int = 0
    private var activeStartupRetryCount = 0
    private var activeStartupStep: StartupStep?
    private var activeStartupStartedAt: Date?
    private let maxStartupRetryCount = 2

    init() {
        Self.sharedInstance = self
    }

    var isBusy: Bool {
        switch state {
        case .starting, .stopping:
            return true
        case .stopped, .running, .unavailable, .failed:
            return false
        }
    }

    private enum Component: String, CaseIterable {
        case postgres
        case redis
        case api
        case processing
        case scraper

        var displayName: String {
            switch self {
            case .postgres:
                return "Postgres"
            case .redis:
                return "Redis"
            case .api:
                return "API"
            case .processing:
                return "Processing"
            case .scraper:
                return "Scraper"
            }
        }

        var statusKind: ComponentStatus.Kind {
            switch self {
            case .postgres:
                return .postgres
            case .redis:
                return .redis
            case .api:
                return .api
            case .processing:
                return .processing
            case .scraper:
                return .scraper
            }
        }

        var logFileName: String {
            switch self {
            case .postgres:
                return "postgres.log"
            case .redis:
                return "redis.log"
            case .api:
                return "api.log"
            case .processing:
                return "worker-processing.log"
            case .scraper:
                return "worker-scraper.log"
            }
        }

        var repoEntryPath: String? {
            switch self {
            case .api:
                return "apps/api/dist/main.js"
            case .processing:
                return "apps/worker-processing/dist/main.js"
            case .scraper:
                return "apps/worker-scraper/dist/main.js"
            case .postgres, .redis:
                return nil
            }
        }
    }

    private struct RuntimeManifest: Decodable {
        struct Scripts: Decodable {
            let postgres: String
            let redis: String
            let migrate: String
        }

        struct Ports: Decodable {
            let postgres: Int
            let redis: Int
            let api: Int
        }

        let version: Int
        let defaultApiBaseURL: String
        let nodeExecutable: String
        let scripts: Scripts
        let ports: Ports
        let artifactsDirectory: String
        let playwrightBrowsersPath: String?
    }

    private enum LaunchMode {
        case bundled(RuntimeManifest)
        case repo(envFileURL: URL?)
    }

    private struct LaunchContext {
        let runtimeRoot: URL
        let runtimeHome: URL
        let nodeExecutableURL: URL
        let apiBaseURL: URL
        let mode: LaunchMode
    }

    private enum RuntimeError: LocalizedError {
        case invalidBaseURL(String)
        case nonLocalBaseURL(String)
        case runtimeArtifactsMissing
        case manifestMissing
        case nodeExecutableMissing
        case apiStartupTimedOut
        case serviceStartupTimedOut(String)
        case portInUse(String, Int)
        case commandFailed(String)

        var errorDescription: String? {
            switch self {
            case .invalidBaseURL(let value):
                return "The API base URL isn’t valid: \(value)"
            case .nonLocalBaseURL(let value):
                return "Run/Stop only works with a local API URL. Current value: \(value)"
            case .runtimeArtifactsMissing:
                return "Couldn’t find the local runtime artifacts for API and workers."
            case .manifestMissing:
                return "The bundled runtime manifest is missing or invalid."
            case .nodeExecutableMissing:
                return "Couldn’t find a Node.js runtime to launch the local backend."
            case .apiStartupTimedOut:
                return "The local API didn’t become healthy in time."
            case .serviceStartupTimedOut(let service):
                return "\(service) didn’t become ready in time."
            case .portInUse(let service, let port):
                return "Can’t start \(service). Port \(port) is already in use."
            case .commandFailed(let description):
                return description
            }
        }
    }

    private var processes: [Component: Process] = [:]
    private var logHandles: [Component: FileHandle] = [:]
    private var processOwners: [Component: Int] = [:]
    private var reusedExternalProcessIDs: [Component: Int32] = [:]
    private var launchedComponentsInActiveAttempt: Set<Component> = []

    static var runtimeHomeURL: URL {
        if let override = ProcessInfo.processInfo.environment["IMMORADAR_RUNTIME_HOME_OVERRIDE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true).standardizedFileURL
        }

        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/ImmoRadar/runtime", isDirectory: true)
    }

    static var logsDirectoryURL: URL {
        if let override = ProcessInfo.processInfo.environment["IMMORADAR_LOGS_DIRECTORY_OVERRIDE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true).standardizedFileURL
        }

        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/ImmoRadar", isDirectory: true)
    }

    static var startupDiagnosticsURL: URL {
        return logsDirectoryURL.appendingPathComponent("startup-diagnostics.json", isDirectory: false)
    }

    func refreshStatus(apiBaseURL: String) async {
        if case .starting = state { return }
        if case .stopping = state { return }

        do {
            let context = try Self.discoverLaunchContext(apiBaseURL: apiBaseURL)
            await syncExternalProcessesIfNeeded(context: context)
            refreshComponentStatuses()
            applyRuntimeMetadata(context)

            let componentStatusMap = Dictionary(
                uniqueKeysWithValues: componentStatuses.map { ($0.kind, $0.isRunning) }
            )
            let usesBundledRuntime = if case .bundled = context.mode { true } else { false }
            let apiHealthy = await Self.isAPIHealthy(baseURL: context.apiBaseURL)
            let hasHealthyManagedComponents = Self.canReuseManagedRuntime(
                usesBundledRuntime: usesBundledRuntime,
                apiHealthy: apiHealthy,
                componentStatuses: componentStatusMap
            )

            if hasHealthyManagedComponents {
                lastStartupFailure = nil
                state = .running
                persistStartupDiagnostics(status: .running, context: context, failure: nil)
            } else if case .failed = state {
                // Preserve the last startup/runtime failure until the user retries or services recover.
                persistStartupDiagnostics(status: .failed, context: context, failure: lastStartupFailure)
            } else {
                reusedExternalProcessIDs.removeAll()
                state = .stopped
                progressStatus = nil
                persistStartupDiagnostics(status: .stopped, context: context, failure: nil)
            }
        } catch let error as RuntimeError {
            let failure = Self.startupFailure(from: error)
            lastStartupFailure = failure
            state = .unavailable(failure.message)
            progressStatus = nil
            persistStartupDiagnostics(status: .failed, context: nil, failure: failure)
        } catch {
            let failure = Self.unexpectedStartupFailure(message: error.localizedDescription)
            lastStartupFailure = failure
            state = .failed(failure.message)
            progressStatus = nil
            persistStartupDiagnostics(status: .failed, context: nil, failure: failure)
        }
    }

    func start(
        apiBaseURL: String,
        bootMode: BootMode = .active,
        policy: StartPolicy = .ifNeeded
    ) async {
        guard !isBusy else { return }

        let attemptID = beginStartupAttempt(bootMode: bootMode)
        do {
            activeBootMode = bootMode
            let context = try Self.discoverLaunchContext(apiBaseURL: apiBaseURL)
            applyRuntimeMetadata(context)
            let authToken = try LocalRuntimeAuth.ensureToken()

            if policy == .ifNeeded,
               await shouldReuseExistingRuntime(context: context, bootMode: bootMode) {
                finishStartupAttempt(status: .running, context: context, failure: nil)
                return
            }

            if policy == .forceRestart || processes.values.contains(where: \.isRunning) {
                await stopManagedProcesses(force: true)
            }

            while true {
                state = .starting
                recordStartupStep(
                    .preparingStorage,
                    context: context,
                    status: activeStartupRetryCount == 0 ? .starting : .retrying
                )
                setProgress(
                    title: activeStartupRetryCount == 0 ? "Preparing local engine" : "Retrying local engine",
                    detail: activeStartupRetryCount == 0
                        ? "Setting up local storage and validating the bundled runtime."
                        : "ImmoRadar is retrying the local engine after a transient startup issue.",
                    fractionCompleted: 0.08
                )

                do {
                    if case .repo = context.mode {
                        try await ensureRepoRuntimeArtifacts(context: context)
                    }

                    switch context.mode {
                    case .bundled(let manifest):
                        try await startBundledStack(
                            context,
                            manifest: manifest,
                            authToken: authToken,
                            bootMode: bootMode,
                            ownerAttemptID: attemptID
                        )
                    case .repo:
                        try await startRepoStack(
                            context,
                            authToken: authToken,
                            bootMode: bootMode,
                            ownerAttemptID: attemptID
                        )
                    }

                    refreshComponentStatuses()
                    lastStartupFailure = nil
                    state = .running
                    progressStatus = nil
                    finishStartupAttempt(status: .running, context: context, failure: nil)
                    return
                } catch let failure as StartupFailure {
                    let launchedManagedProcesses = !launchedComponentsInActiveAttempt.isEmpty

                    if policy == .ifNeeded,
                       !launchedManagedProcesses,
                       await shouldReuseExistingRuntime(context: context, bootMode: bootMode) {
                        finishStartupAttempt(status: .running, context: context, failure: nil)
                        return
                    }

                    if launchedManagedProcesses || policy == .forceRestart {
                        await stopManagedProcesses(force: true)
                    }

                    if activeStartupAttemptID == attemptID,
                       failure.isTransient,
                       activeStartupRetryCount < maxStartupRetryCount {
                        activeStartupRetryCount += 1
                        lastStartupFailure = failure
                        recordStartupStep(failure.step, context: context, status: .retrying, failure: failure)
                        setProgress(
                            title: "Retrying local engine",
                            detail: "A transient startup issue was detected. ImmoRadar is retrying automatically.",
                            fractionCompleted: 0.08
                        )
                        try? await Task.sleep(for: .seconds(2))
                        continue
                    }

                    lastStartupFailure = failure
                    state = .failed(failure.message)
                    progressStatus = nil
                    finishStartupAttempt(status: .failed, context: context, failure: failure)
                    return
                }
            }
        } catch let runtimeError as RuntimeError {
            let failure = Self.startupFailure(from: runtimeError)
            lastStartupFailure = failure
            progressStatus = nil
            finishStartupAttempt(status: .failed, context: nil, failure: failure)

            switch runtimeError {
            case .invalidBaseURL, .nonLocalBaseURL:
                state = .unavailable(failure.message)
            default:
                state = .failed(failure.message)
            }
        } catch {
            let failure = Self.unexpectedStartupFailure(message: error.localizedDescription)
            lastStartupFailure = failure
            state = .failed(failure.message)
            progressStatus = nil
            finishStartupAttempt(status: .failed, context: nil, failure: failure)
        }
    }

    func stop() async {
        guard state != .stopping else { return }
        state = .stopping
        activeStartupAttemptID = nil
        activeStartupStep = nil
        setProgress(
            title: "Stopping local engine",
            detail: "Shutting down workers and local services.",
            fractionCompleted: nil
        )
        persistStartupDiagnostics(status: .stopping, context: nil, failure: nil)
        await stopManagedProcesses(force: true)
        lastStartupFailure = nil
        state = .stopped
        progressStatus = nil
        persistStartupDiagnostics(status: .stopped, context: nil, failure: nil)
    }

    func terminateManagedProcessesForAppExit() {
        let orderedComponents: [Component] = [.scraper, .processing, .api, .redis, .postgres]

        activeStartupAttemptID = nil
        activeStartupStep = nil

        for component in orderedComponents {
            guard let process = processes[component] else { continue }
            if process.isRunning {
                process.terminate()
            }
        }

        Thread.sleep(forTimeInterval: 0.35)

        for component in orderedComponents {
            guard let process = processes[component] else { continue }
            if process.isRunning {
                Darwin.kill(process.processIdentifier, SIGKILL)
            }
            processes[component] = nil
            processOwners[component] = nil
            if let handle = logHandles[component] {
                try? handle.close()
                logHandles[component] = nil
            }
        }

        refreshComponentStatuses()
    }

    func resetLocalEngine() async throws {
        progressStatus = nil
        activeStartupAttemptID = nil
        activeStartupStep = nil
        await stopManagedProcesses(force: true)

        if FileManager.default.fileExists(atPath: Self.runtimeHomeURL.path) {
            try FileManager.default.removeItem(at: Self.runtimeHomeURL)
        }

        LocalRuntimeAuth.resetToken()
        activeBootMode = nil
        lastStartupFailure = nil
        state = .stopped
        refreshComponentStatuses()
        persistStartupDiagnostics(status: .stopped, context: nil, failure: nil)
    }

    func diagnosticsSummary(apiBaseURL: String) -> DiagnosticsSummary {
        let discoveredContext = try? Self.discoverLaunchContext(apiBaseURL: apiBaseURL)
        let runtimeDetails = discoveredContext.map(Self.runtimeDetails) ?? (runtimeDescription ?? "Local engine", runtimeVersion)

        return DiagnosticsSummary(
            runtimeDescription: runtimeDetails.0,
            runtimeVersion: runtimeDetails.1,
            storagePath: Self.runtimeHomeURL.path,
            logsPath: Self.logsDirectoryURL.path,
            startupDiagnosticsPath: Self.startupDiagnosticsURL.path,
            lastErrorMessage: state.failureMessage,
            lastFailureCode: lastStartupFailure?.code.rawValue
        )
    }

    private func startBundledStack(
        _ context: LaunchContext,
        manifest: RuntimeManifest,
        authToken: String,
        bootMode: BootMode,
        ownerAttemptID: Int
    ) async throws {
        let postgresPort = Self.resolvedBundledPostgresPort(manifest)
        let redisPort = Self.resolvedBundledRedisPort(manifest)

        setProgress(
            title: "Preparing local storage",
            detail: "Creating the runtime directories for data, logs, and artifacts.",
            fractionCompleted: 0.12
        )
        recordStartupStep(.preparingStorage, context: context, status: .starting)
        try FileManager.default.createDirectory(
            at: context.runtimeHome.appendingPathComponent("artifacts", isDirectory: true),
            withIntermediateDirectories: true,
            attributes: nil
        )
        try FileManager.default.createDirectory(
            at: context.runtimeHome.appendingPathComponent("logs", isDirectory: true),
            withIntermediateDirectories: true,
            attributes: nil
        )

        if processes[.postgres]?.isRunning != true {
            setProgress(
                title: "Starting Postgres",
                detail: "Bootstrapping the local database for ImmoRadar.",
                fractionCompleted: 0.28
            )
            recordStartupStep(.startingPostgres, context: context, status: .starting)
            try await waitForPortToBecomeAvailable(
                service: "Postgres",
                host: "127.0.0.1",
                port: postgresPort,
                timeout: 15
            )
            try launchShellScript(
                .postgres,
                relativePath: manifest.scripts.postgres,
                context: context,
                authToken: authToken,
                bootMode: bootMode,
                ownerAttemptID: ownerAttemptID
            )
            recordStartupStep(.waitingForPostgres, context: context, status: .starting)
            try await waitForBundledPostgres(
                context: context,
                manifest: manifest
            )
        }

        if processes[.redis]?.isRunning != true {
            setProgress(
                title: "Starting Redis",
                detail: "Bringing up the local queue and scheduler store.",
                fractionCompleted: 0.44
            )
            recordStartupStep(.startingRedis, context: context, status: .starting)
            try await waitForPortToBecomeAvailable(
                service: "Redis",
                host: "127.0.0.1",
                port: redisPort,
                timeout: 12
            )
            try launchShellScript(
                .redis,
                relativePath: manifest.scripts.redis,
                context: context,
                authToken: authToken,
                bootMode: bootMode,
                ownerAttemptID: ownerAttemptID
            )
            recordStartupStep(.waitingForRedis, context: context, status: .starting)
            try await waitForTCP(
                service: "Redis",
                host: "127.0.0.1",
                port: redisPort,
                component: .redis
            )
        }

        setProgress(
            title: "Applying database migrations",
            detail: "Creating the ImmoRadar database and applying the schema.",
            fractionCompleted: 0.58
        )
        recordStartupStep(.applyingMigrations, context: context, status: .starting)
        try await runOneShotShellScript(
            relativePath: manifest.scripts.migrate,
            logFileName: "migrations.log",
            context: context,
            authToken: authToken,
            bootMode: bootMode,
            step: .applyingMigrations
        )

        let apiPort = context.apiBaseURL.port ?? manifest.ports.api
        if processes[.api]?.isRunning != true {
            setProgress(
                title: "Starting API",
                detail: "Launching the local ImmoRadar API and waiting for health checks.",
                fractionCompleted: 0.74
            )
            recordStartupStep(.startingAPI, context: context, status: .starting)
            let apiHost = context.apiBaseURL.host ?? "127.0.0.1"
            let apiPortOccupied = await Self.isTCPPortOpen(
                host: apiHost,
                port: apiPort
            )
            let apiHealthy = await Self.isAPIHealthy(baseURL: context.apiBaseURL)
            if apiPortOccupied && !apiHealthy {
                try await waitForPortToBecomeAvailable(
                    service: "API",
                    host: apiHost,
                    port: apiPort,
                    timeout: 12
                )
            }

            if !(await Self.isAPIHealthy(baseURL: context.apiBaseURL)) {
                try launchNodeComponent(
                    .api,
                    relativePath: "apps/api/dist/main.js",
                    context: context,
                    authToken: authToken,
                    bootMode: bootMode,
                    ownerAttemptID: ownerAttemptID
                )
                recordStartupStep(.waitingForAPI, context: context, status: .starting)
                try await waitForAPI(baseURL: context.apiBaseURL, component: .api)
            }
        }

        if processes[.processing]?.isRunning != true {
            setProgress(
                title: "Starting processing worker",
                detail: "Enabling ingestion, scoring, and lifecycle jobs.",
                fractionCompleted: 0.88
            )
            recordStartupStep(.startingProcessingWorker, context: context, status: .starting)
            try launchNodeComponent(
                .processing,
                relativePath: "apps/worker-processing/dist/main.js",
                context: context,
                authToken: authToken,
                bootMode: bootMode,
                ownerAttemptID: ownerAttemptID
            )
        }

        if processes[.scraper]?.isRunning != true {
            setProgress(
                title: "Starting scraper worker",
                detail: "Registering source schedules and scraper queues.",
                fractionCompleted: 0.96
            )
            recordStartupStep(.startingScraperWorker, context: context, status: .starting)
            try launchNodeComponent(
                .scraper,
                relativePath: "apps/worker-scraper/dist/main.js",
                context: context,
                authToken: authToken,
                bootMode: bootMode,
                ownerAttemptID: ownerAttemptID
            )
        }

        recordStartupStep(.verifyingServices, context: context, status: .starting)
        try? await Task.sleep(for: .milliseconds(600))
        if processes[.api] != nil {
            try ensureComponentRunning(.api)
        }
        try ensureComponentRunning(.processing)
        try ensureComponentRunning(.scraper)
    }

    private func startRepoStack(
        _ context: LaunchContext,
        authToken: String,
        bootMode: BootMode,
        ownerAttemptID: Int
    ) async throws {
        await syncExternalProcessesIfNeeded(context: context)
        setProgress(
            title: "Starting local services",
            detail: "Launching the API and workers from the local repo runtime.",
            fractionCompleted: 0.25
        )
        recordStartupStep(.startingAPI, context: context, status: .starting)
        let apiAlreadyHealthy = await Self.isAPIHealthy(baseURL: context.apiBaseURL)
        if apiAlreadyHealthy, processes[.api]?.isRunning != true {
            await syncExternalProcessesIfNeeded(context: context)
        }
        if processes[.api]?.isRunning != true && !apiAlreadyHealthy {
            try launchNodeComponent(
                .api,
                relativePath: "apps/api/dist/main.js",
                context: context,
                authToken: authToken,
                bootMode: bootMode,
                ownerAttemptID: ownerAttemptID
            )
            recordStartupStep(.waitingForAPI, context: context, status: .starting)
            try await waitForAPI(baseURL: context.apiBaseURL, component: .api)
        }

        if processes[.processing]?.isRunning != true,
           reusedExternalProcessIDs[.processing] == nil {
            setProgress(
                title: "Starting processing worker",
                detail: "Bringing the local processing queues online.",
                fractionCompleted: 0.72
            )
            recordStartupStep(.startingProcessingWorker, context: context, status: .starting)
            try launchNodeComponent(
                .processing,
                relativePath: "apps/worker-processing/dist/main.js",
                context: context,
                authToken: authToken,
                bootMode: bootMode,
                ownerAttemptID: ownerAttemptID
            )
        }

        if processes[.scraper]?.isRunning != true,
           reusedExternalProcessIDs[.scraper] == nil {
            setProgress(
                title: "Starting scraper worker",
                detail: "Registering local scraper schedules.",
                fractionCompleted: 0.9
            )
            recordStartupStep(.startingScraperWorker, context: context, status: .starting)
            try launchNodeComponent(
                .scraper,
                relativePath: "apps/worker-scraper/dist/main.js",
                context: context,
                authToken: authToken,
                bootMode: bootMode,
                ownerAttemptID: ownerAttemptID
            )
        }

        refreshComponentStatuses()
        recordStartupStep(.verifyingServices, context: context, status: .starting)
        try? await Task.sleep(for: .milliseconds(600))
        if processes[.api] != nil || reusedExternalProcessIDs[.api] != nil || apiAlreadyHealthy {
            try ensureComponentRunning(.api)
        }
        try ensureComponentRunning(.processing)
        try ensureComponentRunning(.scraper)
    }

    private func launchNodeComponent(
        _ component: Component,
        relativePath: String,
        context: LaunchContext,
        authToken: String,
        bootMode: BootMode,
        ownerAttemptID: Int
    ) throws {
        let entryURL = context.runtimeRoot.appendingPathComponent(relativePath)
        guard FileManager.default.fileExists(atPath: entryURL.path) else {
            throw Self.startupFailure(from: .runtimeArtifactsMissing)
        }

        let process = Process()
        process.executableURL = context.nodeExecutableURL
        process.arguments = [entryURL.path]
        process.currentDirectoryURL = context.runtimeRoot
        process.environment = Self.makeEnvironment(
            for: context,
            authToken: authToken,
            bootMode: bootMode
        )

        let logHandle = try Self.makeLogHandle(fileName: component.logFileName)
        process.standardOutput = logHandle
        process.standardError = logHandle
        logHandles[component] = logHandle
        reusedExternalProcessIDs[component] = nil

        installTerminationHandler(for: component, process: process, ownerAttemptID: ownerAttemptID)

        do {
            try process.run()
        } catch {
            try? logHandle.close()
            logHandles[component] = nil
            throw Self.commandLaunchFailure(
                component: component,
                message: "Couldn’t launch \(component.displayName). Check ~/Library/Logs/ImmoRadar/\(component.logFileName)."
            )
        }
        processes[component] = process
        processOwners[component] = ownerAttemptID
        if activeStartupAttemptID == ownerAttemptID {
            launchedComponentsInActiveAttempt.insert(component)
        }
        refreshComponentStatuses()
    }

    private func launchShellScript(
        _ component: Component,
        relativePath: String,
        context: LaunchContext,
        authToken: String,
        bootMode: BootMode,
        ownerAttemptID: Int
    ) throws {
        let scriptURL = context.runtimeRoot.appendingPathComponent(relativePath)
        guard FileManager.default.fileExists(atPath: scriptURL.path) else {
            throw Self.startupFailure(from: .runtimeArtifactsMissing)
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptURL.path]
        process.currentDirectoryURL = context.runtimeRoot
        process.environment = Self.makeEnvironment(
            for: context,
            authToken: authToken,
            bootMode: bootMode
        )

        let logHandle = try Self.makeLogHandle(fileName: component.logFileName)
        process.standardOutput = logHandle
        process.standardError = logHandle
        logHandles[component] = logHandle
        reusedExternalProcessIDs[component] = nil

        installTerminationHandler(for: component, process: process, ownerAttemptID: ownerAttemptID)

        do {
            try process.run()
        } catch {
            try? logHandle.close()
            logHandles[component] = nil
            throw Self.commandLaunchFailure(
                component: component,
                message: "Couldn’t launch \(component.displayName). Check ~/Library/Logs/ImmoRadar/\(component.logFileName)."
            )
        }
        processes[component] = process
        processOwners[component] = ownerAttemptID
        if activeStartupAttemptID == ownerAttemptID {
            launchedComponentsInActiveAttempt.insert(component)
        }
        refreshComponentStatuses()
    }

    private func runOneShotShellScript(
        relativePath: String,
        logFileName: String,
        context: LaunchContext,
        authToken: String,
        bootMode: BootMode,
        step: StartupStep
    ) async throws {
        let scriptURL = context.runtimeRoot.appendingPathComponent(relativePath)
        guard FileManager.default.fileExists(atPath: scriptURL.path) else {
            throw Self.startupFailure(from: .runtimeArtifactsMissing)
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptURL.path]
        process.currentDirectoryURL = context.runtimeRoot
        process.environment = Self.makeEnvironment(
            for: context,
            authToken: authToken,
            bootMode: bootMode
        )

        let logHandle = try Self.makeLogHandle(fileName: logFileName)
        process.standardOutput = logHandle
        process.standardError = logHandle

        let timeoutSeconds: TimeInterval = 45
        let timeoutMessage =
            "Migrations timed out after \(Int(timeoutSeconds)) seconds. Check ~/Library/Logs/ImmoRadar/\(logFileName)."
        do {
            try process.run()
        } catch {
            try? logHandle.close()
            throw StartupFailure(
                code: .migrationsFailed,
                message: "Migrations failed. Check ~/Library/Logs/ImmoRadar/\(logFileName).",
                step: step,
                logFileName: logFileName,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        }

        let deadline = Date.now.addingTimeInterval(timeoutSeconds)
        while process.isRunning && Date.now < deadline {
            try? await Task.sleep(for: .milliseconds(200))
        }

        if process.isRunning {
            process.interrupt()
            try? await Task.sleep(for: .milliseconds(150))
            if process.isRunning {
                process.terminate()
            }
            try? logHandle.close()
            throw StartupFailure(
                code: .migrationsTimedOut,
                message: timeoutMessage,
                step: step,
                logFileName: logFileName,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        }

        try? logHandle.close()

        let status = process.terminationStatus
        guard status == 0 else {
            if status == 70 {
                throw StartupFailure(
                    code: .migrationsDatabaseUnavailable,
                    message: "The local database was not ready for migrations yet. ImmoRadar will retry automatically.",
                    step: step,
                    logFileName: logFileName,
                    component: .postgres,
                    exitCode: status,
                    isTransient: true
                )
            }

            throw StartupFailure(
                code: .migrationsFailed,
                message: "Migrations failed. Check ~/Library/Logs/ImmoRadar/\(logFileName).",
                step: step,
                logFileName: logFileName,
                component: nil,
                exitCode: status,
                isTransient: false
            )
        }
    }

    private func installTerminationHandler(
        for component: Component,
        process: Process,
        ownerAttemptID: Int
    ) {
        process.terminationHandler = { [weak self] terminatedProcess in
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard self.processes[component] === terminatedProcess,
                      self.processOwners[component] == ownerAttemptID else {
                    return
                }

                self.processes[component] = nil
                self.processOwners[component] = nil
                if let handle = self.logHandles[component] {
                    try? handle.close()
                    self.logHandles[component] = nil
                }
                self.refreshComponentStatuses()

                if case .starting = self.state {
                    self.persistStartupDiagnostics(status: .starting, context: nil, failure: self.lastStartupFailure)
                    return
                }

                if terminatedProcess.terminationReason == .uncaughtSignal || terminatedProcess.terminationStatus != 0 {
                    if case .stopping = self.state {
                        return
                    }
                    let failure = Self.componentExitFailure(
                        component: component,
                        status: terminatedProcess.terminationStatus,
                        duringStartup: false
                    )
                    self.lastStartupFailure = failure
                    self.progressStatus = nil
                    self.state = .failed(failure.message)
                    self.persistStartupDiagnostics(status: .failed, context: nil, failure: failure)
                } else if self.processes.values.allSatisfy({ !$0.isRunning }) {
                    self.progressStatus = nil
                    self.state = .stopped
                    self.persistStartupDiagnostics(status: .stopped, context: nil, failure: nil)
                }
            }
        }
    }

    private func stopManagedProcesses(force: Bool) async {
        let orderedComponents: [Component] = [.scraper, .processing, .api, .redis, .postgres]

        for component in orderedComponents {
            guard let process = processes[component], process.isRunning else {
                processes[component] = nil
                processOwners[component] = nil
                if let handle = logHandles[component] {
                    try? handle.close()
                    logHandles[component] = nil
                }
                continue
            }

            process.terminate()
        }

        for component in orderedComponents {
            guard let pid = reusedExternalProcessIDs[component], Self.isProcessRunning(pid: pid) else {
                continue
            }
            Darwin.kill(pid, SIGTERM)
        }

        let deadline = Date.now.addingTimeInterval(8)
        while (processes.values.contains(where: \.isRunning)
            || reusedExternalProcessIDs.values.contains(where: Self.isProcessRunning(pid:))),
            Date.now < deadline {
            refreshComponentStatuses()
            try? await Task.sleep(for: .milliseconds(200))
        }

        if force {
            for component in orderedComponents {
                guard let process = processes[component], process.isRunning else { continue }
                process.interrupt()
                try? await Task.sleep(for: .milliseconds(150))
                if process.isRunning {
                    process.terminate()
                }
            }

            for pid in reusedExternalProcessIDs.values where Self.isProcessRunning(pid: pid) {
                Darwin.kill(pid, SIGINT)
                try? await Task.sleep(for: .milliseconds(150))
                if Self.isProcessRunning(pid: pid) {
                    Darwin.kill(pid, SIGTERM)
                }
            }
        }

        for component in orderedComponents where processes[component]?.isRunning != true {
            processes[component] = nil
            processOwners[component] = nil
            if let handle = logHandles[component] {
                try? handle.close()
                logHandles[component] = nil
            }
        }
        reusedExternalProcessIDs.removeAll()

        refreshComponentStatuses()
        progressStatus = nil
    }

    private func waitForAPI(baseURL: URL, component: Component? = nil) async throws {
        let deadline = Date.now.addingTimeInterval(20)
        while Date.now < deadline {
            if await Self.isAPIHealthy(baseURL: baseURL) {
                return
            }

            if let component,
               processes[component]?.isRunning != true {
                throw Self.componentExitFailure(component: component, status: nil, duringStartup: true)
            }
            try? await Task.sleep(for: .milliseconds(300))
        }

        throw StartupFailure(
            code: .apiStartupTimedOut,
            message: "The local API didn’t become healthy in time.",
            step: .waitingForAPI,
            logFileName: Component.api.logFileName,
            component: .api,
            exitCode: nil,
            isTransient: true
        )
    }

    private func waitForBundledPostgres(
        context: LaunchContext,
        manifest: RuntimeManifest
    ) async throws {
        let deadline = Date.now.addingTimeInterval(20)
        while Date.now < deadline {
            if processes[.postgres]?.isRunning != true {
                throw StartupFailure(
                    code: .postgresExitedBeforeReady,
                    message: "Postgres exited before it became ready. Check ~/Library/Logs/ImmoRadar/postgres.log.",
                    step: .waitingForPostgres,
                    logFileName: Component.postgres.logFileName,
                    component: .postgres,
                    exitCode: nil,
                    isTransient: false
                )
            }

            if await Self.isBundledPostgresReady(context: context, manifest: manifest) {
                return
            }

            try? await Task.sleep(for: .milliseconds(250))
        }

        throw StartupFailure(
            code: .postgresStartupTimedOut,
            message: "Postgres didn’t become ready in time.",
            step: .waitingForPostgres,
            logFileName: Component.postgres.logFileName,
            component: .postgres,
            exitCode: nil,
            isTransient: true
        )
    }

    private func waitForTCP(
        service: String,
        host: String,
        port: Int,
        component: Component? = nil
    ) async throws {
        let deadline = Date.now.addingTimeInterval(20)
        while Date.now < deadline {
            if await Self.isTCPPortOpen(host: host, port: port) {
                return
            }

            if let component,
               processes[component]?.isRunning != true {
                throw Self.componentExitFailure(component: component, status: nil, duringStartup: true)
            }
            try? await Task.sleep(for: .milliseconds(250))
        }

        let failureCode: StartupFailure.Code = component == .redis ? .redisStartupTimedOut : .componentExitedUnexpectedly
        let logFileName = component?.logFileName
        throw StartupFailure(
            code: failureCode,
            message: "\(service) didn’t become ready in time.",
            step: component == .redis ? .waitingForRedis : .verifyingServices,
            logFileName: logFileName,
            component: component,
            exitCode: nil,
            isTransient: component == .redis
        )
    }

    private func waitForPortToBecomeAvailable(
        service: String,
        host: String,
        port: Int,
        timeout: TimeInterval
    ) async throws {
        let deadline = Date.now.addingTimeInterval(timeout)

        while await Self.isTCPPortOpen(host: host, port: port), Date.now < deadline {
            try? await Task.sleep(for: .milliseconds(250))
        }

        if await Self.isTCPPortOpen(host: host, port: port) {
            throw StartupFailure(
                code: .portInUse,
                message: "Can’t start \(service). Port \(port) is already in use.",
                step: service == "Postgres" ? .startingPostgres : service == "Redis" ? .startingRedis : .startingAPI,
                logFileName: nil,
                component: service == "Postgres" ? .postgres : service == "Redis" ? .redis : .api,
                exitCode: nil,
                isTransient: true
            )
        }
    }

    private func beginStartupAttempt(bootMode: BootMode) -> Int {
        nextStartupAttemptID += 1
        activeStartupAttemptID = nextStartupAttemptID
        activeStartupRetryCount = 0
        activeStartupStep = nil
        activeStartupStartedAt = Date.now
        activeBootMode = bootMode
        lastStartupFailure = nil
        launchedComponentsInActiveAttempt = []
        return nextStartupAttemptID
    }

    private func finishStartupAttempt(
        status: StartupDiagnosticsStatus,
        context: LaunchContext?,
        failure: StartupFailure?
    ) {
        persistStartupDiagnostics(status: status, context: context, failure: failure)
        activeStartupAttemptID = nil
        activeStartupStep = nil
        activeStartupStartedAt = nil
        launchedComponentsInActiveAttempt = []
    }

    private func recordStartupStep(
        _ step: StartupStep?,
        context: LaunchContext?,
        status: StartupDiagnosticsStatus,
        failure: StartupFailure? = nil
    ) {
        activeStartupStep = step
        persistStartupDiagnostics(status: status, context: context, failure: failure)
    }

    private func persistStartupDiagnostics(
        status: StartupDiagnosticsStatus,
        context: LaunchContext?,
        failure: StartupFailure?
    ) {
        let runtimeDetails = context.map(Self.runtimeDetails) ?? (runtimeDescription ?? "Local engine", runtimeVersion)
        let payload = StartupDiagnosticsPayload(
            attemptID: activeStartupAttemptID,
            bootMode: activeBootMode?.rawValue,
            runtimeDescription: runtimeDetails.0,
            runtimeVersion: runtimeDetails.1,
            storagePath: Self.runtimeHomeURL.path,
            logsPath: Self.logsDirectoryURL.path,
            status: status.rawValue,
            step: activeStartupStep?.rawValue,
            retryCount: activeStartupRetryCount,
            maxRetryCount: maxStartupRetryCount,
            failureCode: failure?.code.rawValue ?? lastStartupFailure?.code.rawValue,
            failureMessage: failure?.message ?? lastStartupFailure?.message,
            logFileName: failure?.logFileName ?? lastStartupFailure?.logFileName,
            startedAt: activeStartupStartedAt,
            updatedAt: Date.now,
            components: componentStatuses.map {
                StartupDiagnosticsComponentSnapshot(
                    component: $0.kind.rawValue,
                    isRunning: $0.isRunning,
                    pid: $0.pid
                )
            }
        )

        do {
            try FileManager.default.createDirectory(
                at: Self.logsDirectoryURL,
                withIntermediateDirectories: true,
                attributes: nil
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(payload)
            try data.write(to: Self.startupDiagnosticsURL, options: .atomic)
        } catch {
            // Diagnostics are best-effort and must never block startup/shutdown flows.
        }
    }

    private func ensureComponentRunning(_ component: Component) throws {
        if let process = processes[component] {
            guard process.isRunning else {
                throw Self.componentExitFailure(
                    component: component,
                    status: process.terminationStatus,
                    duringStartup: true
                )
            }
            return
        }

        if let reusedPID = reusedExternalProcessIDs[component] {
            guard Self.isProcessRunning(pid: reusedPID) else {
                throw Self.componentExitFailure(component: component, status: nil, duringStartup: true)
            }
            return
        }

        throw Self.componentExitFailure(component: component, status: nil, duringStartup: true)
    }

    private func refreshComponentStatuses() {
        componentStatuses = Component.allCases.map { component in
            let process = processes[component]
            return ComponentStatus(
                kind: component.statusKind,
                isRunning: process?.isRunning == true || reusedExternalProcessIDs[component].map(Self.isProcessRunning(pid:)) == true,
                pid: process?.processIdentifier ?? reusedExternalProcessIDs[component]
            )
        }
    }

    private func syncExternalProcessesIfNeeded(context: LaunchContext) async {
        guard case .repo = context.mode else {
            reusedExternalProcessIDs.removeAll()
            return
        }

        let detected = await Self.detectRepoComponentPIDs(runtimeRoot: context.runtimeRoot)
        let kindToComponent: [ComponentStatus.Kind: Component] = [
            .api: .api,
            .processing: .processing,
            .scraper: .scraper,
        ]

        for (kind, component) in kindToComponent {
            if processes[component]?.isRunning == true {
                reusedExternalProcessIDs[component] = nil
            } else {
                reusedExternalProcessIDs[component] = detected[kind]
            }
        }
    }

    private func setProgress(title: String, detail: String, fractionCompleted: Double?) {
        progressStatus = ProgressStatus(
            title: title,
            detail: detail,
            fractionCompleted: fractionCompleted
        )
    }

    private func ensureRepoRuntimeArtifacts(context: LaunchContext) async throws {
        guard case .repo = context.mode else { return }
        guard !Self.hasRepoRuntimeArtifacts(at: context.runtimeRoot) else { return }

        let root = context.runtimeRoot
        let fileManager = FileManager.default
        let nodeModulesURL = root.appendingPathComponent("node_modules", isDirectory: true)
        let turboScriptURL = root.appendingPathComponent(Self.repoBootstrapTurboScriptRelativePath)

        guard fileManager.fileExists(atPath: nodeModulesURL.path) else {
            throw StartupFailure(
                code: .repoBootstrapDependenciesMissing,
                message: "Developer runtime dependencies are missing. Run `npm ci` in the repo root, then retry.",
                step: .bootstrappingRepoRuntime,
                logFileName: nil,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        }

        guard fileManager.fileExists(atPath: turboScriptURL.path) else {
            throw StartupFailure(
                code: .repoBootstrapToolMissing,
                message: "ImmoRadar couldn’t find the local build toolchain. Reinstall workspace dependencies with `npm ci`, then retry.",
                step: .bootstrappingRepoRuntime,
                logFileName: nil,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        }

        recordStartupStep(.bootstrappingRepoRuntime, context: context, status: .starting)
        setProgress(
            title: "Preparing developer runtime",
            detail: "Building local API and worker artifacts for this Debug install.",
            fractionCompleted: 0.16
        )

        let process = Process()
        process.executableURL = context.nodeExecutableURL
        process.arguments = [
            turboScriptURL.path,
            "run",
            "build",
            "--filter=@immoradar/api",
            "--filter=@immoradar/worker-processing",
            "--filter=@immoradar/worker-scraper",
        ]
        process.currentDirectoryURL = root

        var environment = ProcessInfo.processInfo.environment
        let nodeBinDirectory = context.nodeExecutableURL.deletingLastPathComponent().path
        let defaultPath = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
        let existingPath = environment["PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let basePath = (existingPath?.isEmpty == false ? existingPath! : defaultPath)
        if basePath.split(separator: ":").contains(Substring(nodeBinDirectory)) {
            environment["PATH"] = basePath
        } else {
            environment["PATH"] = "\(nodeBinDirectory):\(basePath)"
        }
        process.environment = environment

        let logHandle = try Self.makeLogHandle(fileName: Self.repoBootstrapLogFileName)
        process.standardOutput = logHandle
        process.standardError = logHandle

        do {
            try process.run()
        } catch {
            try? logHandle.close()
            throw StartupFailure(
                code: .repoBootstrapToolMissing,
                message: "ImmoRadar couldn’t launch the developer runtime build. Check ~/Library/Logs/ImmoRadar/\(Self.repoBootstrapLogFileName).",
                step: .bootstrappingRepoRuntime,
                logFileName: Self.repoBootstrapLogFileName,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        }

        let deadline = Date.now.addingTimeInterval(180)
        while process.isRunning && Date.now < deadline {
            try? await Task.sleep(for: .milliseconds(250))
        }

        if process.isRunning {
            process.interrupt()
            try? await Task.sleep(for: .milliseconds(150))
            if process.isRunning {
                process.terminate()
            }
            try? logHandle.close()
            throw StartupFailure(
                code: .repoBootstrapFailed,
                message: "Building the developer runtime timed out. Check ~/Library/Logs/ImmoRadar/\(Self.repoBootstrapLogFileName).",
                step: .bootstrappingRepoRuntime,
                logFileName: Self.repoBootstrapLogFileName,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        }

        try? logHandle.close()

        guard process.terminationStatus == 0 else {
            throw StartupFailure(
                code: .repoBootstrapFailed,
                message: "ImmoRadar found the developer runtime source but couldn’t build it. Check ~/Library/Logs/ImmoRadar/\(Self.repoBootstrapLogFileName).",
                step: .bootstrappingRepoRuntime,
                logFileName: Self.repoBootstrapLogFileName,
                component: nil,
                exitCode: process.terminationStatus,
                isTransient: false
            )
        }

        guard Self.hasRepoRuntimeArtifacts(at: root) else {
            throw StartupFailure(
                code: .repoBootstrapFailed,
                message: "The developer runtime build completed but the API and worker artifacts are still missing. Check ~/Library/Logs/ImmoRadar/\(Self.repoBootstrapLogFileName).",
                step: .bootstrappingRepoRuntime,
                logFileName: Self.repoBootstrapLogFileName,
                component: nil,
                exitCode: process.terminationStatus,
                isTransient: false
            )
        }
    }

    private func shouldReuseExistingRuntime(
        context: LaunchContext,
        bootMode: BootMode
    ) async -> Bool {
        await syncExternalProcessesIfNeeded(context: context)
        refreshComponentStatuses()

        let componentStatusMap = Dictionary(
            uniqueKeysWithValues: componentStatuses.map { ($0.kind, $0.isRunning) }
        )
        let usesBundledRuntime = if case .bundled = context.mode { true } else { false }

        let hasHealthyManagedComponents = Self.canReuseManagedRuntime(
            usesBundledRuntime: usesBundledRuntime,
            apiHealthy: await Self.isAPIHealthy(baseURL: context.apiBaseURL),
            componentStatuses: componentStatusMap
        )

        guard hasHealthyManagedComponents else {
            return false
        }

        activeBootMode = bootMode
        lastStartupFailure = nil
        progressStatus = nil
        state = .running
        persistStartupDiagnostics(status: .running, context: context, failure: nil)
        return true
    }

    static func canReuseManagedRuntime(
        usesBundledRuntime: Bool,
        apiHealthy: Bool,
        componentStatuses: [ComponentStatus.Kind: Bool]
    ) -> Bool {
        guard apiHealthy else {
            return false
        }

        let requiredComponents: [ComponentStatus.Kind] = usesBundledRuntime
            ? [.postgres, .redis, .api, .processing, .scraper]
            : [.api, .processing, .scraper]

        return requiredComponents.allSatisfy { componentStatuses[$0] == true }
    }

    nonisolated static func detectRepoComponentPIDs(runtimeRoot: URL) async -> [ComponentStatus.Kind: Int32] {
        await Task.detached(priority: .utility) {
            let processList = currentProcessListOutput()
            return detectRepoComponentPIDs(processListOutput: processList, runtimeRoot: runtimeRoot)
        }.value
    }

    nonisolated static func detectRepoComponentPIDs(
        processListOutput: String,
        runtimeRoot: URL
    ) -> [ComponentStatus.Kind: Int32] {
        let runtimeRootPath = runtimeRoot.standardizedFileURL.path
        let expectedPaths: [ComponentStatus.Kind: String] = [
            .api: "\(runtimeRootPath)/apps/api/dist/main.js",
            .processing: "\(runtimeRootPath)/apps/worker-processing/dist/main.js",
            .scraper: "\(runtimeRootPath)/apps/worker-scraper/dist/main.js",
        ]

        var detected: [ComponentStatus.Kind: Int32] = [:]
        for rawLine in processListOutput.split(whereSeparator: \.isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty else { continue }

            let parts = line.split(maxSplits: 1, whereSeparator: \.isWhitespace)
            guard parts.count == 2,
                  let pid = Int32(parts[0]) else { continue }

            let command = String(parts[1])
            for (kind, expectedPath) in expectedPaths where command.contains(expectedPath) {
                detected[kind] = pid
            }
        }

        return detected
    }

    nonisolated private static func currentProcessListOutput() -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-axo", "pid=,command="]
        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = Pipe()

        do {
            try process.run()
        } catch {
            return ""
        }

        let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            return ""
        }
        return String(decoding: data, as: UTF8.self)
    }

    private static func isProcessRunning(pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        return Darwin.kill(pid, 0) == 0
    }

    private static func startupFailure(from error: RuntimeError) -> StartupFailure {
        switch error {
        case .invalidBaseURL(let value):
            return StartupFailure(
                code: .invalidBaseURL,
                message: "The API base URL isn’t valid: \(value)",
                step: nil,
                logFileName: nil,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        case .nonLocalBaseURL(let value):
            return StartupFailure(
                code: .nonLocalBaseURL,
                message: "Run/Stop only works with a local API URL. Current value: \(value)",
                step: nil,
                logFileName: nil,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        case .runtimeArtifactsMissing:
            return StartupFailure(
                code: .runtimeArtifactsMissing,
                message: "Couldn’t find the local runtime artifacts for API and workers.",
                step: nil,
                logFileName: nil,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        case .manifestMissing:
            return StartupFailure(
                code: .manifestMissing,
                message: "The bundled runtime manifest is missing or invalid.",
                step: nil,
                logFileName: nil,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        case .nodeExecutableMissing:
            return StartupFailure(
                code: .nodeExecutableMissing,
                message: "Couldn’t find a Node.js runtime to launch the local backend.",
                step: nil,
                logFileName: nil,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        case .apiStartupTimedOut:
            return StartupFailure(
                code: .apiStartupTimedOut,
                message: "The local API didn’t become healthy in time.",
                step: .waitingForAPI,
                logFileName: Component.api.logFileName,
                component: .api,
                exitCode: nil,
                isTransient: true
            )
        case .serviceStartupTimedOut(let service):
            let component: Component? =
                service == "Postgres" ? .postgres
                : service == "Redis" ? .redis
                : nil
            let code: StartupFailure.Code =
                service == "Postgres" ? .postgresStartupTimedOut
                : service == "Redis" ? .redisStartupTimedOut
                : .componentExitedUnexpectedly

            return StartupFailure(
                code: code,
                message: "\(service) didn’t become ready in time.",
                step: component == .postgres ? .waitingForPostgres : component == .redis ? .waitingForRedis : .verifyingServices,
                logFileName: component?.logFileName,
                component: component,
                exitCode: nil,
                isTransient: service == "Postgres" || service == "Redis"
            )
        case .portInUse(let service, let port):
            return StartupFailure(
                code: .portInUse,
                message: "Can’t start \(service). Port \(port) is already in use.",
                step: service == "Postgres" ? .startingPostgres : service == "Redis" ? .startingRedis : .startingAPI,
                logFileName: nil,
                component: service == "Postgres" ? .postgres : service == "Redis" ? .redis : .api,
                exitCode: nil,
                isTransient: true
            )
        case .commandFailed(let description):
            return StartupFailure(
                code: .componentExitedUnexpectedly,
                message: description,
                step: .verifyingServices,
                logFileName: nil,
                component: nil,
                exitCode: nil,
                isTransient: false
            )
        }
    }

    private static func unexpectedStartupFailure(message: String) -> StartupFailure {
        StartupFailure(
            code: .componentExitedUnexpectedly,
            message: message,
            step: .verifyingServices,
            logFileName: nil,
            component: nil,
            exitCode: nil,
            isTransient: false
        )
    }

    private static func commandLaunchFailure(component: Component, message: String) -> StartupFailure {
        StartupFailure(
            code: .componentExitedUnexpectedly,
            message: message,
            step: component == .postgres ? .startingPostgres
                : component == .redis ? .startingRedis
                : component == .api ? .startingAPI
                : component == .processing ? .startingProcessingWorker
                : .startingScraperWorker,
            logFileName: component.logFileName,
            component: component,
            exitCode: nil,
            isTransient: component == .postgres || component == .redis || component == .api
        )
    }

    private static func componentExitFailure(
        component: Component,
        status: Int32?,
        duringStartup: Bool
    ) -> StartupFailure {
        let isCoreService = component == .postgres || component == .redis || component == .api
        let code: StartupFailure.Code
        let message: String
        let step: StartupStep

        switch component {
        case .postgres:
            code = .postgresExitedBeforeReady
            message = "Postgres exited before it became ready. Check ~/Library/Logs/ImmoRadar/\(component.logFileName)."
            step = .waitingForPostgres
        case .redis:
            code = .redisExitedBeforeReady
            message = "Redis exited before it became ready. Check ~/Library/Logs/ImmoRadar/\(component.logFileName)."
            step = .waitingForRedis
        case .api:
            code = duringStartup ? .apiExitedBeforeHealthy : .componentExitedUnexpectedly
            message = "The local API exited unexpectedly. Check ~/Library/Logs/ImmoRadar/\(component.logFileName)."
            step = .waitingForAPI
        case .processing:
            code = .componentExitedUnexpectedly
            message = "Processing exited unexpectedly. Check ~/Library/Logs/ImmoRadar/\(component.logFileName)."
            step = .startingProcessingWorker
        case .scraper:
            code = .componentExitedUnexpectedly
            message = "Scraper exited unexpectedly. Check ~/Library/Logs/ImmoRadar/\(component.logFileName)."
            step = .startingScraperWorker
        }

        return StartupFailure(
            code: code,
            message: message,
            step: step,
            logFileName: component.logFileName,
            component: component,
            exitCode: status,
            isTransient: duringStartup && isCoreService
        )
    }


    private func applyRuntimeMetadata(_ context: LaunchContext) {
        let details = Self.runtimeDetails(context)
        runtimeDescription = details.0
        runtimeVersion = details.1
    }

    private static func runtimeDetails(_ context: LaunchContext) -> (String, String?) {
        switch context.mode {
        case .bundled(let manifest):
            return ("Bundled runtime", "Runtime v\(manifest.version)")
        case .repo:
            return ("Developer runtime", nil)
        }
    }

    private static func discoverLaunchContext(apiBaseURL: String) throws -> LaunchContext {
        guard let url = URL(string: apiBaseURL), let host = url.host else {
            throw RuntimeError.invalidBaseURL(apiBaseURL)
        }

        let normalizedHost = host.lowercased()
        let localHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"]
        guard localHosts.contains(normalizedHost) else {
            throw RuntimeError.nonLocalBaseURL(apiBaseURL)
        }

        var normalizedComponents = URLComponents(url: url, resolvingAgainstBaseURL: false)
        normalizedComponents?.host = "127.0.0.1"
        guard let normalizedURL = normalizedComponents?.url else {
            throw RuntimeError.invalidBaseURL(apiBaseURL)
        }

        let runtimeHome = Self.runtimeHomeURL

        if let bundledContext = try discoverBundledLaunchContext(
            apiBaseURL: normalizedURL,
            runtimeHome: runtimeHome
        ) {
            return bundledContext
        }

        let runtimeRoot = try findRepoRuntimeRoot()
        let nodeExecutableURL = try findNodeExecutable(under: runtimeRoot)
        let envFileURL = [
            runtimeRoot.appendingPathComponent(".env"),
            runtimeRoot.appendingPathComponent(".env.local"),
        ].first(where: { FileManager.default.fileExists(atPath: $0.path) })

        return LaunchContext(
            runtimeRoot: runtimeRoot,
            runtimeHome: runtimeHome,
            nodeExecutableURL: nodeExecutableURL,
            apiBaseURL: normalizedURL,
            mode: .repo(envFileURL: envFileURL)
        )
    }

    private static func discoverBundledLaunchContext(
        apiBaseURL: URL,
        runtimeHome: URL
    ) throws -> LaunchContext? {
        guard let resourceURL = Bundle.main.resourceURL else { return nil }
        let runtimeRoot = resourceURL.appendingPathComponent("runtime", isDirectory: true)
        let manifestURL = runtimeRoot.appendingPathComponent("manifest.json")

        guard FileManager.default.fileExists(atPath: manifestURL.path) else {
            return nil
        }

        let manifestData: Data
        do {
            manifestData = try Data(contentsOf: manifestURL)
        } catch {
            throw RuntimeError.manifestMissing
        }

        let manifest: RuntimeManifest
        do {
            manifest = try JSONDecoder().decode(RuntimeManifest.self, from: manifestData)
        } catch {
            throw RuntimeError.manifestMissing
        }
        let nodeExecutableURL = runtimeRoot.appendingPathComponent(manifest.nodeExecutable)

        guard FileManager.default.isExecutableFile(atPath: nodeExecutableURL.path) else {
            throw RuntimeError.nodeExecutableMissing
        }

        return LaunchContext(
            runtimeRoot: runtimeRoot,
            runtimeHome: runtimeHome,
            nodeExecutableURL: nodeExecutableURL,
            apiBaseURL: apiBaseURL,
            mode: .bundled(manifest)
        )
    }

    static func findRepoRuntimeRoot(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        bundleURL: URL = Bundle.main.bundleURL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URL {
        let candidates = orderedUniqueURLs(
            urls: runtimeRootCandidates(
                currentDirectoryPath: currentDirectoryPath,
                bundleURL: bundleURL,
                environment: environment
            )
        )

        for candidate in candidates where hasRepoWorkspaceLayout(at: candidate) {
            return candidate
        }

        throw RuntimeError.runtimeArtifactsMissing
    }

    static func runtimeRootCandidates(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        bundleURL: URL = Bundle.main.bundleURL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> [URL] {
        let cwd = URL(fileURLWithPath: currentDirectoryPath, isDirectory: true)
        let bundleParentURL = bundleURL.deletingLastPathComponent().standardizedFileURL

        var candidates: [URL] = []

        if let override = repoRootOverrideURL(environment: environment) {
            candidates.append(override)
        }

        candidates += ancestorURLs(of: cwd)
        candidates += ancestorURLs(of: bundleParentURL)

#if DEBUG
        if let sourceRoot = debugSourceRepoRootCandidate() {
            candidates.append(sourceRoot)
        }
#endif

        return candidates
    }

    private static func repoRootOverrideURL(environment: [String: String]) -> URL? {
        guard let raw = environment["IMMORADAR_REPO_ROOT_OVERRIDE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !raw.isEmpty else {
            return nil
        }

        return URL(fileURLWithPath: raw, isDirectory: true).standardizedFileURL
    }

#if DEBUG
    private static func debugSourceRepoRootCandidate() -> URL? {
        let sourceDirectory = URL(fileURLWithPath: #filePath, isDirectory: false)
            .deletingLastPathComponent()
            .standardizedFileURL

        return ancestorURLs(of: sourceDirectory).first(where: hasRepoWorkspaceLayout)
    }
#endif

    private static func ancestorURLs(of start: URL) -> [URL] {
        var results: [URL] = []
        var seenPaths = Set<String>()
        var current = start.standardizedFileURL

        while true {
            let currentPath = current.path
            guard seenPaths.insert(currentPath).inserted else { break }

            results.append(current)

            let parent = current.deletingLastPathComponent().standardizedFileURL
            if parent.path == currentPath { break }
            current = parent
        }
        return results
    }

    private static func orderedUniqueURLs(urls: [URL]) -> [URL] {
        var seen = Set<String>()
        var result: [URL] = []
        for url in urls {
            let path = url.standardizedFileURL.path
            if seen.insert(path).inserted {
                result.append(url.standardizedFileURL)
            }
        }
        return result
    }

    static func hasRepoWorkspaceLayout(at root: URL) -> Bool {
        repoWorkspaceMarkerRelativePaths.allSatisfy {
            FileManager.default.fileExists(atPath: root.appendingPathComponent($0).path)
        }
    }

    static func hasRepoRuntimeArtifacts(at root: URL) -> Bool {
        repoRuntimeArtifactRelativePaths.allSatisfy {
            FileManager.default.fileExists(atPath: root.appendingPathComponent($0).path)
        }
    }

    private static func findNodeExecutable(under root: URL) throws -> URL {
        let bundledCandidates = [
            root.appendingPathComponent("node"),
            root.appendingPathComponent("bin/node"),
            root.appendingPathComponent("node/bin/node"),
        ]

        for candidate in bundledCandidates where FileManager.default.isExecutableFile(atPath: candidate.path) {
            return candidate
        }

        let searchPaths = (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
            .map { URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("node") }

        for candidate in searchPaths where FileManager.default.isExecutableFile(atPath: candidate.path) {
            return candidate
        }

        throw RuntimeError.nodeExecutableMissing
    }

    private static func environmentPortOverride(_ key: String) -> Int? {
        guard let raw = ProcessInfo.processInfo.environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
              let port = Int(raw),
              (1...65535).contains(port) else {
            return nil
        }

        return port
    }

    private static func resolvedBundledPostgresPort(_ manifest: RuntimeManifest) -> Int {
        environmentPortOverride("IMMORADAR_POSTGRES_PORT_OVERRIDE") ?? manifest.ports.postgres
    }

    private static func resolvedBundledRedisPort(_ manifest: RuntimeManifest) -> Int {
        environmentPortOverride("IMMORADAR_REDIS_PORT_OVERRIDE") ?? manifest.ports.redis
    }

    private static func makeEnvironment(
        for context: LaunchContext,
        authToken: String,
        bootMode: BootMode
    ) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment

        switch context.mode {
        case .bundled(let manifest):
            let postgresPort = resolvedBundledPostgresPort(manifest)
            let redisPort = resolvedBundledRedisPort(manifest)
            environment["NODE_ENV"] = "development"
            environment["LC_ALL"] = "C"
            environment["LANG"] = "C"
            environment["LC_CTYPE"] = "C"
            environment["IMMORADAR_RUNTIME_HOME"] = context.runtimeHome.path
            environment["IMMORADAR_POSTGRES_PORT"] = String(postgresPort)
            environment["IMMORADAR_REDIS_PORT"] = String(redisPort)
            environment["DATABASE_URL"] = "postgres://postgres@127.0.0.1:\(postgresPort)/immoradar"
            environment["REDIS_URL"] = "redis://127.0.0.1:\(redisPort)"
            environment["PROMETHEUS_ENABLED"] = "false"
            environment["S3_BUCKET"] = context.runtimeHome
                .appendingPathComponent(manifest.artifactsDirectory, isDirectory: true)
                .path
            environment["S3_ENDPOINT"] = "filesystem://immoradar-local"
            environment["S3_REGION"] = "local"
            environment["S3_ACCESS_KEY"] = "local"
            environment["S3_SECRET_KEY"] = "local"
            environment["S3_FORCE_PATH_STYLE"] = "true"

            if let browsersPath = manifest.playwrightBrowsersPath {
                let resolved = context.runtimeRoot.appendingPathComponent(browsersPath)
                if FileManager.default.fileExists(atPath: resolved.path) {
                    environment["PLAYWRIGHT_BROWSERS_PATH"] = resolved.path
                }
            }

        case .repo(let envFileURL):
            if let envFileURL {
                for (key, value) in parseEnvFile(at: envFileURL) {
                    environment[key] = value
                }
            }
            environment["NODE_ENV"] = environment["NODE_ENV"] ?? "development"
        }

        let port = context.apiBaseURL.port ?? 8080
        let host = "127.0.0.1"

        environment["API_HOST"] = host
        environment["API_PORT"] = String(port)
        environment["API_BASE_URL"] = "http://127.0.0.1:\(port)"
        environment["API_BEARER_TOKEN"] = authToken
        environment["API_AUTH_MODE"] = "single_user_token"
        environment["IMMORADAR_RUNTIME_BOOT_MODE"] = bootMode.rawValue

        return environment
    }

    private static func parseEnvFile(at url: URL) -> [String: String] {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return [:] }

        var parsed: [String: String] = [:]
        for line in raw.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, !trimmed.hasPrefix("#") else { continue }
            guard let separatorIndex = trimmed.firstIndex(of: "=") else { continue }

            let key = String(trimmed[..<separatorIndex]).trimmingCharacters(in: .whitespaces)
            var value = String(trimmed[trimmed.index(after: separatorIndex)...])
                .trimmingCharacters(in: .whitespaces)

            if (value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'")) {
                value.removeFirst()
                value.removeLast()
            }

            parsed[key] = value
        }

        return parsed
    }

    private static func makeLogHandle(fileName: String) throws -> FileHandle {
        let logsDirectory = Self.logsDirectoryURL

        try FileManager.default.createDirectory(
            at: logsDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )

        let fileURL = logsDirectory.appendingPathComponent(fileName)
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        }

        let handle = try FileHandle(forWritingTo: fileURL)
        try handle.seekToEnd()
        return handle
    }

    private static func isAPIHealthy(baseURL: URL) async -> Bool {
        guard let healthURL = URL(string: "/health", relativeTo: baseURL)?.absoluteURL else {
            return false
        }

        var request = URLRequest(url: healthURL)
        request.timeoutInterval = 2

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else { return false }
            return (200..<300).contains(httpResponse.statusCode)
        } catch {
            return false
        }
    }

    private static func isBundledPostgresReady(
        context: LaunchContext,
        manifest: RuntimeManifest
    ) async -> Bool {
        let postgresPort = resolvedBundledPostgresPort(manifest)
        let pgIsReadyURL = context.runtimeRoot.appendingPathComponent("infra/postgres/bin/pg_isready")
        guard FileManager.default.isExecutableFile(atPath: pgIsReadyURL.path) else {
            return await isTCPPortOpen(host: "127.0.0.1", port: postgresPort)
        }

        return await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = pgIsReadyURL
            process.arguments = [
                "-h", "127.0.0.1",
                "-p", String(postgresPort),
                "-d", "postgres",
                "-U", "postgres",
                "-t", "1",
            ]

            process.terminationHandler = { terminatedProcess in
                continuation.resume(returning: terminatedProcess.terminationStatus == 0)
            }

            do {
                try process.run()
            } catch {
                continuation.resume(returning: false)
            }
        }
    }

    private static func isTCPPortOpen(host: String, port: Int) async -> Bool {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/nc")
            process.arguments = ["-z", host, String(port)]

            process.terminationHandler = { terminatedProcess in
                continuation.resume(returning: terminatedProcess.terminationStatus == 0)
            }

            do {
                try process.run()
            } catch {
                continuation.resume(returning: false)
            }
        }
    }
}
