import Foundation

@MainActor @Observable
final class LocalRuntimeService {

    enum State: Equatable {
        case stopped
        case starting
        case running
        case stopping
        case unavailable(String)
        case failed(String)

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

    var state: State = .stopped
    var progressStatus: ProgressStatus?
    var componentStatuses: [ComponentStatus] = Component.allCases.map {
        ComponentStatus(kind: $0.statusKind, isRunning: false, pid: nil)
    }

    var isBusy: Bool {
        switch state {
        case .starting, .stopping:
            return true
        case .stopped, .running, .unavailable, .failed:
            return false
        }
    }

    private enum Component: CaseIterable {
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
        let authToken: String
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

    func refreshStatus(apiBaseURL: String) async {
        refreshComponentStatuses()

        if case .starting = state { return }
        if case .stopping = state { return }

        do {
            _ = try Self.discoverLaunchContext(apiBaseURL: apiBaseURL, authToken: "dev-token")
            let managedCount = processes.values.count(where: \.isRunning)
            state = managedCount > 0 ? .running : .stopped
            if managedCount == 0 {
                progressStatus = nil
            }
        } catch let error as RuntimeError {
            state = .unavailable(error.localizedDescription)
            progressStatus = nil
        } catch {
            state = .failed(error.localizedDescription)
            progressStatus = nil
        }
    }

    func start(apiBaseURL: String, authToken: String) async {
        guard !isBusy else { return }

        do {
            state = .starting
            setProgress(
                title: "Preparing local engine",
                detail: "Setting up local storage and validating the bundled runtime.",
                fractionCompleted: 0.08
            )
            let context = try Self.discoverLaunchContext(
                apiBaseURL: apiBaseURL,
                authToken: authToken.isEmpty ? "dev-token" : authToken
            )

            switch context.mode {
            case .bundled(let manifest):
                try await startBundledStack(context, manifest: manifest)
            case .repo:
                try await startRepoStack(context)
            }

            refreshComponentStatuses()
            state = .running
            progressStatus = nil
        } catch {
            await stopManagedProcesses(force: true)
            state = .failed(error.localizedDescription)
            progressStatus = nil
        }
    }

    func stop() async {
        guard !isBusy else { return }
        state = .stopping
        setProgress(
            title: "Stopping local engine",
            detail: "Shutting down workers and local services.",
            fractionCompleted: nil
        )
        await stopManagedProcesses(force: false)
        state = .stopped
        progressStatus = nil
    }

    private func startBundledStack(_ context: LaunchContext, manifest: RuntimeManifest) async throws {
        setProgress(
            title: "Preparing local storage",
            detail: "Creating the runtime directories for data, logs, and artifacts.",
            fractionCompleted: 0.12
        )
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
            if await Self.isTCPPortOpen(host: "127.0.0.1", port: manifest.ports.postgres) {
                throw RuntimeError.portInUse("Postgres", manifest.ports.postgres)
            }
            try launchShellScript(.postgres, relativePath: manifest.scripts.postgres, context: context)
            try await waitForTCP(service: "Postgres", host: "127.0.0.1", port: manifest.ports.postgres)
        }

        if processes[.redis]?.isRunning != true {
            setProgress(
                title: "Starting Redis",
                detail: "Bringing up the local queue and scheduler store.",
                fractionCompleted: 0.44
            )
            if await Self.isTCPPortOpen(host: "127.0.0.1", port: manifest.ports.redis) {
                throw RuntimeError.portInUse("Redis", manifest.ports.redis)
            }
            try launchShellScript(.redis, relativePath: manifest.scripts.redis, context: context)
            try await waitForTCP(service: "Redis", host: "127.0.0.1", port: manifest.ports.redis)
        }

        setProgress(
            title: "Applying database migrations",
            detail: "Creating the ImmoRadar database and applying the schema.",
            fractionCompleted: 0.58
        )
        try await runOneShotShellScript(
            relativePath: manifest.scripts.migrate,
            logFileName: "migrations.log",
            context: context
        )

        let apiPort = context.apiBaseURL.port ?? manifest.ports.api
        if processes[.api]?.isRunning != true {
            setProgress(
                title: "Starting API",
                detail: "Launching the local ImmoRadar API and waiting for health checks.",
                fractionCompleted: 0.74
            )
            let apiPortOccupied = await Self.isTCPPortOpen(
                host: context.apiBaseURL.host ?? "127.0.0.1",
                port: apiPort
            )
            let apiHealthy = await Self.isAPIHealthy(baseURL: context.apiBaseURL)
            if apiPortOccupied && !apiHealthy {
                throw RuntimeError.portInUse("API", apiPort)
            }

            if !apiHealthy {
                try launchNodeComponent(.api, relativePath: "apps/api/dist/main.js", context: context)
                try await waitForAPI(baseURL: context.apiBaseURL)
            }
        }

        if processes[.processing]?.isRunning != true {
            setProgress(
                title: "Starting processing worker",
                detail: "Enabling ingestion, scoring, and lifecycle jobs.",
                fractionCompleted: 0.88
            )
            try launchNodeComponent(.processing, relativePath: "apps/worker-processing/dist/main.js", context: context)
        }

        if processes[.scraper]?.isRunning != true {
            setProgress(
                title: "Starting scraper worker",
                detail: "Registering source schedules and scraper queues.",
                fractionCompleted: 0.96
            )
            try launchNodeComponent(.scraper, relativePath: "apps/worker-scraper/dist/main.js", context: context)
        }

        try? await Task.sleep(for: .milliseconds(600))
    }

    private func startRepoStack(_ context: LaunchContext) async throws {
        setProgress(
            title: "Starting local services",
            detail: "Launching the API and workers from the local repo runtime.",
            fractionCompleted: 0.25
        )
        let apiAlreadyHealthy = await Self.isAPIHealthy(baseURL: context.apiBaseURL)
        if processes[.api]?.isRunning != true && !apiAlreadyHealthy {
            try launchNodeComponent(.api, relativePath: "apps/api/dist/main.js", context: context)
            try await waitForAPI(baseURL: context.apiBaseURL)
        }

        if processes[.processing]?.isRunning != true {
            setProgress(
                title: "Starting processing worker",
                detail: "Bringing the local processing queues online.",
                fractionCompleted: 0.72
            )
            try launchNodeComponent(.processing, relativePath: "apps/worker-processing/dist/main.js", context: context)
        }

        if processes[.scraper]?.isRunning != true {
            setProgress(
                title: "Starting scraper worker",
                detail: "Registering local scraper schedules.",
                fractionCompleted: 0.9
            )
            try launchNodeComponent(.scraper, relativePath: "apps/worker-scraper/dist/main.js", context: context)
        }

        try? await Task.sleep(for: .milliseconds(600))
    }

    private func launchNodeComponent(
        _ component: Component,
        relativePath: String,
        context: LaunchContext
    ) throws {
        let entryURL = context.runtimeRoot.appendingPathComponent(relativePath)
        guard FileManager.default.fileExists(atPath: entryURL.path) else {
            throw RuntimeError.runtimeArtifactsMissing
        }

        let process = Process()
        process.executableURL = context.nodeExecutableURL
        process.arguments = [entryURL.path]
        process.currentDirectoryURL = context.runtimeRoot
        process.environment = Self.makeEnvironment(for: context)

        let logHandle = try Self.makeLogHandle(fileName: component.logFileName)
        process.standardOutput = logHandle
        process.standardError = logHandle
        logHandles[component] = logHandle

        installTerminationHandler(for: component, process: process)

        try process.run()
        processes[component] = process
        refreshComponentStatuses()
    }

    private func launchShellScript(
        _ component: Component,
        relativePath: String,
        context: LaunchContext
    ) throws {
        let scriptURL = context.runtimeRoot.appendingPathComponent(relativePath)
        guard FileManager.default.fileExists(atPath: scriptURL.path) else {
            throw RuntimeError.runtimeArtifactsMissing
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptURL.path]
        process.currentDirectoryURL = context.runtimeRoot
        process.environment = Self.makeEnvironment(for: context)

        let logHandle = try Self.makeLogHandle(fileName: component.logFileName)
        process.standardOutput = logHandle
        process.standardError = logHandle
        logHandles[component] = logHandle

        installTerminationHandler(for: component, process: process)

        try process.run()
        processes[component] = process
        refreshComponentStatuses()
    }

    private func runOneShotShellScript(
        relativePath: String,
        logFileName: String,
        context: LaunchContext
    ) async throws {
        let scriptURL = context.runtimeRoot.appendingPathComponent(relativePath)
        guard FileManager.default.fileExists(atPath: scriptURL.path) else {
            throw RuntimeError.runtimeArtifactsMissing
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptURL.path]
        process.currentDirectoryURL = context.runtimeRoot
        process.environment = Self.makeEnvironment(for: context)

        let logHandle = try Self.makeLogHandle(fileName: logFileName)
        process.standardOutput = logHandle
        process.standardError = logHandle

        let status = await withCheckedContinuation { (continuation: CheckedContinuation<Int32, Never>) in
            process.terminationHandler = { terminatedProcess in
                continuation.resume(returning: terminatedProcess.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(returning: 1)
            }
        }

        try? logHandle.close()

        guard status == 0 else {
            throw RuntimeError.commandFailed("Migrations failed. Check ~/Library/Logs/ImmoRadar/\(logFileName).")
        }
    }

    private func installTerminationHandler(for component: Component, process: Process) {
        process.terminationHandler = { [weak self] terminatedProcess in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if self.processes[component] === terminatedProcess {
                    self.processes[component] = nil
                }
                if let handle = self.logHandles[component] {
                    try? handle.close()
                    self.logHandles[component] = nil
                }
                self.refreshComponentStatuses()

                if terminatedProcess.terminationReason == .uncaughtSignal || terminatedProcess.terminationStatus != 0 {
                    if case .stopping = self.state {
                        return
                    }
                    self.progressStatus = nil
                    self.state = .failed("\(component.displayName) exited unexpectedly. Check ~/Library/Logs/ImmoRadar/\(component.logFileName).")
                } else if self.processes.values.allSatisfy({ !$0.isRunning }) {
                    self.progressStatus = nil
                    self.state = .stopped
                }
            }
        }
    }

    private func stopManagedProcesses(force: Bool) async {
        let orderedComponents: [Component] = [.scraper, .processing, .api, .redis, .postgres]

        for component in orderedComponents {
            guard let process = processes[component], process.isRunning else {
                processes[component] = nil
                if let handle = logHandles[component] {
                    try? handle.close()
                    logHandles[component] = nil
                }
                continue
            }

            process.terminate()
        }

        let deadline = Date().addingTimeInterval(8)
        while processes.values.contains(where: \.isRunning), Date() < deadline {
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
        }

        refreshComponentStatuses()
        progressStatus = nil
    }

    private func waitForAPI(baseURL: URL) async throws {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if await Self.isAPIHealthy(baseURL: baseURL) {
                return
            }
            try? await Task.sleep(for: .milliseconds(300))
        }
        throw RuntimeError.apiStartupTimedOut
    }

    private func waitForTCP(service: String, host: String, port: Int) async throws {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if await Self.isTCPPortOpen(host: host, port: port) {
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
        throw RuntimeError.serviceStartupTimedOut(service)
    }

    private func refreshComponentStatuses() {
        componentStatuses = Component.allCases.map { component in
            let process = processes[component]
            return ComponentStatus(
                kind: component.statusKind,
                isRunning: process?.isRunning == true,
                pid: process?.processIdentifier
            )
        }
    }

    private func setProgress(title: String, detail: String, fractionCompleted: Double?) {
        progressStatus = ProgressStatus(
            title: title,
            detail: detail,
            fractionCompleted: fractionCompleted
        )
    }

    private static func discoverLaunchContext(apiBaseURL: String, authToken: String) throws -> LaunchContext {
        guard let url = URL(string: apiBaseURL), let host = url.host else {
            throw RuntimeError.invalidBaseURL(apiBaseURL)
        }

        let normalizedHost = host.lowercased()
        let localHosts = ["localhost", "127.0.0.1", "0.0.0.0"]
        guard localHosts.contains(normalizedHost) else {
            throw RuntimeError.nonLocalBaseURL(apiBaseURL)
        }

        let runtimeHome = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/ImmoRadar/runtime", isDirectory: true)

        if let bundledContext = try discoverBundledLaunchContext(
            apiBaseURL: url,
            authToken: authToken,
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
            apiBaseURL: url,
            authToken: authToken,
            mode: .repo(envFileURL: envFileURL)
        )
    }

    private static func discoverBundledLaunchContext(
        apiBaseURL: URL,
        authToken: String,
        runtimeHome: URL
    ) throws -> LaunchContext? {
        guard let resourceURL = Bundle.main.resourceURL else { return nil }
        let runtimeRoot = resourceURL.appendingPathComponent("runtime", isDirectory: true)
        let manifestURL = runtimeRoot.appendingPathComponent("manifest.json")

        guard FileManager.default.fileExists(atPath: manifestURL.path) else {
            return nil
        }

        let manifestData = try Data(contentsOf: manifestURL)
        let manifest = try JSONDecoder().decode(RuntimeManifest.self, from: manifestData)
        let nodeExecutableURL = runtimeRoot.appendingPathComponent(manifest.nodeExecutable)

        guard FileManager.default.isExecutableFile(atPath: nodeExecutableURL.path) else {
            throw RuntimeError.nodeExecutableMissing
        }

        return LaunchContext(
            runtimeRoot: runtimeRoot,
            runtimeHome: runtimeHome,
            nodeExecutableURL: nodeExecutableURL,
            apiBaseURL: apiBaseURL,
            authToken: authToken,
            mode: .bundled(manifest)
        )
    }

    private static func findRepoRuntimeRoot() throws -> URL {
        let candidates = orderedUniqueURLs(urls: runtimeRootCandidates())

        for candidate in candidates where hasRepoRuntimeArtifacts(at: candidate) {
            return candidate
        }

        throw RuntimeError.runtimeArtifactsMissing
    }

    private static func runtimeRootCandidates() -> [URL] {
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let bundleURL = Bundle.main.bundleURL.deletingLastPathComponent()

        return ancestorURLs(of: cwd) + ancestorURLs(of: bundleURL)
    }

    private static func ancestorURLs(of start: URL) -> [URL] {
        var results: [URL] = []
        var current = start.standardizedFileURL
        while true {
            results.append(current)
            let parent = current.deletingLastPathComponent()
            if parent.path == current.path { break }
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

    private static func hasRepoRuntimeArtifacts(at root: URL) -> Bool {
        let requiredPaths = [
            "apps/api/dist/main.js",
            "apps/worker-processing/dist/main.js",
            "apps/worker-scraper/dist/main.js",
        ]

        return requiredPaths.allSatisfy {
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

    private static func makeEnvironment(for context: LaunchContext) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment

        switch context.mode {
        case .bundled(let manifest):
            environment["NODE_ENV"] = "production"
            environment["IMMORADAR_RUNTIME_HOME"] = context.runtimeHome.path
            environment["IMMORADAR_POSTGRES_PORT"] = String(manifest.ports.postgres)
            environment["IMMORADAR_REDIS_PORT"] = String(manifest.ports.redis)
            environment["DATABASE_URL"] = "postgres://postgres@127.0.0.1:\(manifest.ports.postgres)/immoradar"
            environment["REDIS_URL"] = "redis://127.0.0.1:\(manifest.ports.redis)"
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
        let host = context.apiBaseURL.host ?? "127.0.0.1"

        environment["API_HOST"] = host == "0.0.0.0" ? "127.0.0.1" : host
        environment["API_PORT"] = String(port)
        environment["API_BASE_URL"] = context.apiBaseURL.absoluteString
        environment["API_BEARER_TOKEN"] = context.authToken
        environment["API_AUTH_MODE"] = "single_user_token"

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
        let logsDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/ImmoRadar", isDirectory: true)

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
