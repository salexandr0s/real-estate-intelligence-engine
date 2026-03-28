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
                return "The local API and scraper workers are idle."
            case .starting:
                return "Launching the local API and workers."
            case .running:
                return "The local API plus scraper workers are active."
            case .stopping:
                return "Stopping the local API and workers."
            case .unavailable(let message), .failed(let message):
                return message
            }
        }
    }

    struct ComponentStatus: Identifiable, Hashable {
        enum Kind: String {
            case api = "API"
            case processing = "Processing"
            case scraper = "Scraper"
        }

        let kind: Kind
        var isRunning: Bool
        var pid: Int32?

        var id: Kind { kind }
    }

    var state: State = .stopped
    var componentStatuses: [ComponentStatus] = [
        ComponentStatus(kind: .api, isRunning: false, pid: nil),
        ComponentStatus(kind: .processing, isRunning: false, pid: nil),
        ComponentStatus(kind: .scraper, isRunning: false, pid: nil),
    ]

    var isBusy: Bool {
        switch state {
        case .starting, .stopping:
            return true
        case .stopped, .running, .unavailable, .failed:
            return false
        }
    }

    private enum Component: CaseIterable {
        case api
        case processing
        case scraper

        var displayName: String {
            switch self {
            case .api:
                return "API"
            case .processing:
                return "Processing"
            case .scraper:
                return "Scraper"
            }
        }

        var relativeScriptPath: String {
            switch self {
            case .api:
                return "apps/api/dist/main.js"
            case .processing:
                return "apps/worker-processing/dist/main.js"
            case .scraper:
                return "apps/worker-scraper/dist/main.js"
            }
        }

        var logFileName: String {
            switch self {
            case .api:
                return "api.log"
            case .processing:
                return "worker-processing.log"
            case .scraper:
                return "worker-scraper.log"
            }
        }

        var statusKind: ComponentStatus.Kind {
            switch self {
            case .api:
                return .api
            case .processing:
                return .processing
            case .scraper:
                return .scraper
            }
        }
    }

    private struct LaunchContext {
        let runtimeRoot: URL
        let nodeExecutableURL: URL
        let apiBaseURL: URL
        let authToken: String
        let envFileURL: URL?

        func scriptURL(for component: Component) -> URL {
            runtimeRoot.appendingPathComponent(component.relativeScriptPath)
        }
    }

    private enum RuntimeError: LocalizedError {
        case invalidBaseURL(String)
        case nonLocalBaseURL(String)
        case runtimeArtifactsMissing
        case nodeExecutableMissing
        case apiStartupTimedOut

        var errorDescription: String? {
            switch self {
            case .invalidBaseURL(let value):
                return "The API base URL isn’t valid: \(value)"
            case .nonLocalBaseURL(let value):
                return "Run/Stop only works with a local API URL. Current value: \(value)"
            case .runtimeArtifactsMissing:
                return "Couldn’t find the bundled/local runtime artifacts for API and workers."
            case .nodeExecutableMissing:
                return "Couldn’t find a Node.js runtime to launch the local backend."
            case .apiStartupTimedOut:
                return "The local API didn’t become healthy in time."
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

            if managedCount > 0 {
                state = .running
            } else {
                state = .stopped
            }
        } catch let error as RuntimeError {
            state = .unavailable(error.localizedDescription)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func start(apiBaseURL: String, authToken: String) async {
        guard !isBusy else { return }

        do {
            state = .starting
            let context = try Self.discoverLaunchContext(
                apiBaseURL: apiBaseURL,
                authToken: authToken.isEmpty ? "dev-token" : authToken
            )

            let apiAlreadyHealthy = await Self.isAPIHealthy(baseURL: context.apiBaseURL)
            if processes[.api]?.isRunning != true && !apiAlreadyHealthy {
                try launch(.api, context: context)
                try await waitForAPI(baseURL: context.apiBaseURL)
            }

            if processes[.processing]?.isRunning != true {
                try launch(.processing, context: context)
            }

            if processes[.scraper]?.isRunning != true {
                try launch(.scraper, context: context)
            }

            try await Task.sleep(for: .milliseconds(600))
            refreshComponentStatuses()
            state = .running
        } catch {
            await stopManagedProcesses(force: true)
            state = .failed(error.localizedDescription)
        }
    }

    func stop() async {
        guard !isBusy else { return }
        state = .stopping
        await stopManagedProcesses(force: false)
        state = .stopped
    }

    private func launch(_ component: Component, context: LaunchContext) throws {
        let scriptURL = context.scriptURL(for: component)
        guard FileManager.default.fileExists(atPath: scriptURL.path) else {
            throw RuntimeError.runtimeArtifactsMissing
        }

        let process = Process()
        process.executableURL = context.nodeExecutableURL
        process.arguments = [scriptURL.path]
        process.currentDirectoryURL = context.runtimeRoot
        process.environment = Self.makeEnvironment(for: context)

        let logHandle = try Self.makeLogHandle(fileName: component.logFileName)
        process.standardOutput = logHandle
        process.standardError = logHandle
        logHandles[component] = logHandle

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
                    self.state = .failed("\(component.displayName) exited unexpectedly. Check ~/Library/Logs/ImmoRadar/\(component.logFileName).")
                } else if self.processes.values.allSatisfy({ !$0.isRunning }) {
                    self.state = .stopped
                }
            }
        }

        try process.run()
        processes[component] = process
        refreshComponentStatuses()
    }

    private func stopManagedProcesses(force: Bool) async {
        let orderedComponents: [Component] = [.scraper, .processing, .api]

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

    private static func discoverLaunchContext(apiBaseURL: String, authToken: String) throws -> LaunchContext {
        guard let url = URL(string: apiBaseURL), let host = url.host else {
            throw RuntimeError.invalidBaseURL(apiBaseURL)
        }

        let normalizedHost = host.lowercased()
        let localHosts = ["localhost", "127.0.0.1", "0.0.0.0"]
        guard localHosts.contains(normalizedHost) else {
            throw RuntimeError.nonLocalBaseURL(apiBaseURL)
        }

        let runtimeRoot = try findRuntimeRoot()
        let nodeExecutableURL = try findNodeExecutable(under: runtimeRoot)
        let envFileURL = [
            runtimeRoot.appendingPathComponent(".env"),
            runtimeRoot.appendingPathComponent(".env.local"),
        ].first(where: { FileManager.default.fileExists(atPath: $0.path) })

        return LaunchContext(
            runtimeRoot: runtimeRoot,
            nodeExecutableURL: nodeExecutableURL,
            apiBaseURL: url,
            authToken: authToken,
            envFileURL: envFileURL
        )
    }

    private static func findRuntimeRoot() throws -> URL {
        let candidates = orderedUniqueURLs(
            urls: runtimeRootCandidates()
        )

        for candidate in candidates where hasRuntimeArtifacts(at: candidate) {
            return candidate
        }

        throw RuntimeError.runtimeArtifactsMissing
    }

    private static func runtimeRootCandidates() -> [URL] {
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let bundleURL = Bundle.main.bundleURL.deletingLastPathComponent()
        let resourceRuntimeURL = Bundle.main.resourceURL?.appendingPathComponent("runtime", isDirectory: true)

        return ancestorURLs(of: cwd)
            + ancestorURLs(of: bundleURL)
            + (resourceRuntimeURL.map { [$0] } ?? [])
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

    private static func hasRuntimeArtifacts(at root: URL) -> Bool {
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

        if let envFileURL = context.envFileURL {
            for (key, value) in parseEnvFile(at: envFileURL) {
                environment[key] = value
            }
        }

        let port = context.apiBaseURL.port ?? 8080
        let host = context.apiBaseURL.host ?? "localhost"

        environment["API_HOST"] = host == "0.0.0.0" ? "127.0.0.1" : host
        environment["API_PORT"] = String(port)
        environment["API_BASE_URL"] = context.apiBaseURL.absoluteString
        environment["API_BEARER_TOKEN"] = context.authToken
        environment["API_AUTH_MODE"] = "single_user_token"

        if environment["NODE_ENV"] == nil {
            environment["NODE_ENV"] = "development"
        }

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
}
