import Foundation

/// Where everything the engine needs lives, for a bundled runtime or a developer checkout. Both run
/// the same scripts on the same ports and the same data, so Debug and Release differ only in where
/// the binaries come from. Resolving it reads the disk and may spawn a shell, so it runs off main.
struct EngineLayout: Equatable, Sendable {
    enum Mode: Equatable, Sendable {
        case bundled(runtimeVersion: Int)
        case repo
    }

    struct Ports: Equatable, Sendable {
        let postgres: Int
        let redis: Int
        let api: Int
    }

    enum LayoutError: LocalizedError, Equatable {
        case invalidBaseURL(String)
        case nonLocalBaseURL(String)
        case runtimeArtifactsMissing
        case manifestMissing
        case nodeExecutableMissing
        case serviceMissing(name: String, installCommand: String)

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
            case .serviceMissing(let name, let installCommand):
                return "\(name) isn’t installed. Install it with: \(installCommand)"
            }
        }
    }

    private struct RuntimeManifest: Decodable {
        struct Scripts: Decodable {
            let postgres: String
            let redis: String
            let migrate: String
            let watchdog: String
        }

        struct ManifestPorts: Decodable {
            let postgres: Int
            let redis: Int
            let api: Int
        }

        let version: Int
        let nodeExecutable: String
        let scripts: Scripts
        let ports: ManifestPorts
        let artifactsDirectory: String
        let playwrightBrowsersPath: String?
    }

    static let defaultPorts = Ports(postgres: 55432, redis: 56379, api: 58080)

    private static let repoWorkspaceMarkerRelativePaths = [
        "package.json",
        "apps/api/package.json",
        "apps/worker-processing/package.json",
        "apps/worker-scraper/package.json",
    ]

    private static let repoRuntimeArtifactRelativePaths = [
        "apps/api/dist/main.js",
        "apps/worker-processing/dist/main.js",
        "apps/worker-scraper/dist/main.js",
    ]

    let mode: Mode
    let runtimeRoot: URL
    let runtimeHome: URL
    let logsDirectory: URL
    let nodeExecutable: URL
    let postgresScript: URL
    let redisScript: URL
    let migrateScript: URL
    let watchdogScript: URL
    let postgresBinDirectory: URL
    let ports: Ports
    let apiBaseURL: URL
    let sharedEnvironment: [String: String]

    var apiEntry: URL { runtimeRoot.appendingPathComponent("apps/api/dist/main.js") }
    var processingEntry: URL { runtimeRoot.appendingPathComponent("apps/worker-processing/dist/main.js") }
    var scraperEntry: URL { runtimeRoot.appendingPathComponent("apps/worker-scraper/dist/main.js") }
    var turboScript: URL { runtimeRoot.appendingPathComponent("node_modules/turbo/bin/turbo") }
    var nodeModulesDirectory: URL { runtimeRoot.appendingPathComponent("node_modules", isDirectory: true) }
    var runRecordFile: URL { runtimeHome.appendingPathComponent("engine-run.json", isDirectory: false) }

    var usesRepoBuild: Bool { mode == .repo }

    var runtimeDescription: String {
        switch mode {
        case .bundled: return "Bundled runtime"
        case .repo: return "Developer runtime"
        }
    }

    var runtimeVersion: String? {
        switch mode {
        case .bundled(let version): return "Runtime v\(version)"
        case .repo: return nil
        }
    }

    /// The home marker finds every engine process and its descendants, including Chromium. The tag
    /// finds one generation of one slot, so a crashed scraper's browser dies and the new one lives.
    func environment(slot: EngineSlot, generation: Int, runID: UUID, token: String) -> [String: String] {
        var environment = sharedEnvironment
        environment["API_BEARER_TOKEN"] = token
        environment["IMMORADAR_ENGINE_HOME"] = runtimeHome.path + "/"
        environment["IMMORADAR_ENGINE_TAG"] = "\(runID.uuidString).\(slot.rawValue).\(generation)."
        if let megabytes = slot.nodeHeapLimitMegabytes {
            // Appended last, so it wins over a heap flag that came in from the environment.
            let cap = "--max-old-space-size=\(megabytes)"
            let existing = environment["NODE_OPTIONS"]?.trimmingCharacters(in: .whitespaces) ?? ""
            environment["NODE_OPTIONS"] = existing.isEmpty ? cap : "\(existing) \(cap)"
        }
        return environment
    }

    // MARK: - Resolving

    static func resolve(apiBaseURL: String) async throws -> EngineLayout {
        try await Task.detached(priority: .utility) {
            try resolveNow(apiBaseURL: apiBaseURL, environment: ProcessInfo.processInfo.environment)
        }.value
    }

    private static func resolveNow(apiBaseURL: String, environment: [String: String]) throws -> EngineLayout {
        let normalizedURL = try normalizedAPIBaseURL(apiBaseURL)
        if let bundled = try bundledLayout(apiBaseURL: normalizedURL, environment: environment) {
            return bundled
        }
        return try repoLayout(apiBaseURL: normalizedURL, environment: environment)
    }

    private static func normalizedAPIBaseURL(_ apiBaseURL: String) throws -> URL {
        guard let url = URL(string: apiBaseURL), let host = url.host else {
            throw LayoutError.invalidBaseURL(apiBaseURL)
        }
        guard ["localhost", "127.0.0.1", "0.0.0.0", "::1"].contains(host.lowercased()) else {
            throw LayoutError.nonLocalBaseURL(apiBaseURL)
        }

        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.host = "127.0.0.1"
        guard let normalized = components?.url else {
            throw LayoutError.invalidBaseURL(apiBaseURL)
        }
        return normalized
    }

    private static func bundledLayout(apiBaseURL: URL, environment: [String: String]) throws -> EngineLayout? {
        guard let resourceURL = Bundle.main.resourceURL else { return nil }
        let root = resourceURL.appendingPathComponent("runtime", isDirectory: true)
        let manifestURL = root.appendingPathComponent("manifest.json")
        guard FileManager.default.fileExists(atPath: manifestURL.path) else { return nil }

        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(RuntimeManifest.self, from: data) else {
            throw LayoutError.manifestMissing
        }

        let node = root.appendingPathComponent(manifest.nodeExecutable)
        guard FileManager.default.isExecutableFile(atPath: node.path) else {
            throw LayoutError.nodeExecutableMissing
        }

        let home = runtimeHomeURL(environment: environment)
        let ports = Ports(
            postgres: portOverride("IMMORADAR_POSTGRES_PORT_OVERRIDE", environment) ?? manifest.ports.postgres,
            redis: portOverride("IMMORADAR_REDIS_PORT_OVERRIDE", environment) ?? manifest.ports.redis,
            api: apiBaseURL.port ?? manifest.ports.api
        )
        let browsers = manifest.playwrightBrowsersPath.flatMap { relativePath -> URL? in
            let url = root.appendingPathComponent(relativePath)
            return FileManager.default.fileExists(atPath: url.path) ? url : nil
        }

        return EngineLayout(
            mode: .bundled(runtimeVersion: manifest.version),
            runtimeRoot: root,
            runtimeHome: home,
            logsDirectory: logsDirectoryURL(environment: environment),
            nodeExecutable: node,
            postgresScript: root.appendingPathComponent(manifest.scripts.postgres),
            redisScript: root.appendingPathComponent(manifest.scripts.redis),
            migrateScript: root.appendingPathComponent(manifest.scripts.migrate),
            watchdogScript: root.appendingPathComponent(manifest.scripts.watchdog),
            postgresBinDirectory: root.appendingPathComponent("infra/postgres/bin", isDirectory: true),
            ports: ports,
            apiBaseURL: apiBaseURL,
            sharedEnvironment: makeSharedEnvironment(
                inherited: environment,
                envFiles: [],
                runtimeHome: home,
                artifactsDirectory: home.appendingPathComponent(manifest.artifactsDirectory, isDirectory: true),
                ports: ports,
                extras: browsers.map { ["PLAYWRIGHT_BROWSERS_PATH": $0.path] } ?? [:]
            )
        )
    }

    private static func repoLayout(apiBaseURL: URL, environment: [String: String]) throws -> EngineLayout {
        let root = try findRepoRuntimeRoot(environment: environment)
        let node = try findNodeExecutable(under: root, environment: environment)
        let postgresBin = try serviceBinDirectory(
            binary: "postgres",
            overrideKey: "IMMORADAR_POSTGRES_BIN_DIR",
            candidates: ["/opt/homebrew/opt/postgresql@17/bin", "/usr/local/opt/postgresql@17/bin"],
            name: "Postgres",
            installCommand: "brew install postgresql@17",
            environment: environment
        )
        let redisBin = try serviceBinDirectory(
            binary: "redis-server",
            overrideKey: "IMMORADAR_REDIS_BIN_DIR",
            candidates: ["/opt/homebrew/opt/redis/bin", "/opt/homebrew/bin", "/usr/local/bin"],
            name: "Redis",
            installCommand: "brew install redis",
            environment: environment
        )

        let home = runtimeHomeURL(environment: environment)
        let ports = Ports(
            postgres: portOverride("IMMORADAR_POSTGRES_PORT_OVERRIDE", environment) ?? defaultPorts.postgres,
            redis: portOverride("IMMORADAR_REDIS_PORT_OVERRIDE", environment) ?? defaultPorts.redis,
            api: apiBaseURL.port ?? defaultPorts.api
        )
        let scripts = root.appendingPathComponent("scripts/runtime", isDirectory: true)
        let nodeDirectory = node.deletingLastPathComponent().path
        let inheritedPath = environment["PATH"].flatMap { $0.isEmpty ? nil : $0 }
            ?? "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"

        return EngineLayout(
            mode: .repo,
            runtimeRoot: root,
            runtimeHome: home,
            logsDirectory: logsDirectoryURL(environment: environment),
            nodeExecutable: node,
            postgresScript: scripts.appendingPathComponent("start-postgres.sh"),
            redisScript: scripts.appendingPathComponent("start-redis.sh"),
            migrateScript: scripts.appendingPathComponent("run-migrations.sh"),
            watchdogScript: scripts.appendingPathComponent("engine-watchdog.sh"),
            postgresBinDirectory: postgresBin,
            ports: ports,
            apiBaseURL: apiBaseURL,
            sharedEnvironment: makeSharedEnvironment(
                inherited: environment,
                envFiles: [root.appendingPathComponent(".env"), root.appendingPathComponent(".env.local")],
                runtimeHome: home,
                artifactsDirectory: home.appendingPathComponent("artifacts", isDirectory: true),
                ports: ports,
                extras: [
                    "PATH": "\(nodeDirectory):\(inheritedPath)",
                    "IMMORADAR_RUNTIME_ROOT": root.path,
                    "IMMORADAR_POSTGRES_BIN_DIR": postgresBin.path,
                    "IMMORADAR_REDIS_BIN_DIR": redisBin.path,
                    "IMMORADAR_NODE_BIN": node.path,
                    "IMMORADAR_MIGRATE_SCRIPT": root.appendingPathComponent("packages/db/dist/migrate.js").path,
                ]
            )
        )
    }

    private static func serviceBinDirectory(
        binary: String,
        overrideKey: String,
        candidates: [String],
        name: String,
        installCommand: String,
        environment: [String: String]
    ) throws -> URL {
        let override = environment[overrideKey]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let directories = ([override].compactMap { $0 } + candidates).filter { !$0.isEmpty }
        for directory in directories
        where FileManager.default.isExecutableFile(atPath: directory + "/" + binary) {
            return URL(fileURLWithPath: directory, isDirectory: true)
        }
        throw LayoutError.serviceMissing(name: name, installCommand: installCommand)
    }

    private static func portOverride(_ key: String, _ environment: [String: String]) -> Int? {
        guard let raw = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
              let port = Int(raw),
              (1...65535).contains(port) else {
            return nil
        }
        return port
    }

    // MARK: - Environment

    private static func makeSharedEnvironment(
        inherited: [String: String],
        envFiles: [URL],
        runtimeHome: URL,
        artifactsDirectory: URL,
        ports: Ports,
        extras: [String: String]
    ) -> [String: String] {
        var environment = inherited

        // Files only fill gaps, so a value set when launching the app wins over them.
        var fileValues: [String: String] = [:]
        for file in envFiles {
            fileValues.merge(parseEnvFile(at: file)) { _, later in later }
        }
        environment.merge(fileValues) { current, _ in current }

        // Everything below describes this engine, so it wins over both. Production mode would
        // demand TLS to Postgres and a Redis password, which a loopback engine doesn't have.
        environment["NODE_ENV"] = "development"
        environment["LC_ALL"] = "C"
        environment["LANG"] = "C"
        environment["LC_CTYPE"] = "C"
        environment["IMMORADAR_RUNTIME_HOME"] = runtimeHome.path
        environment["IMMORADAR_POSTGRES_PORT"] = String(ports.postgres)
        environment["IMMORADAR_REDIS_PORT"] = String(ports.redis)
        environment["DATABASE_URL"] = "postgres://postgres@127.0.0.1:\(ports.postgres)/immoradar"
        // start-postgres.sh caps Postgres at 30 connections for the API, both workers and
        // migrations, so a larger pool from a stale .env would run out of them.
        environment["DATABASE_POOL_MAX"] = "4"
        environment["REDIS_URL"] = "redis://127.0.0.1:\(ports.redis)"
        environment["PROMETHEUS_ENABLED"] = "false"
        environment["ARTIFACTS_DIR"] = artifactsDirectory.path
        environment["API_HOST"] = "127.0.0.1"
        environment["API_PORT"] = String(ports.api)
        environment["API_BASE_URL"] = "http://127.0.0.1:\(ports.api)"
        environment["API_AUTH_MODE"] = "single_user_token"
        environment["API_DOCS_PUBLIC"] = "false"
        // Paused monitoring means no worker processes, so a worker that runs is always active.
        environment["IMMORADAR_RUNTIME_BOOT_MODE"] = "active"

        environment.merge(extras) { _, extra in extra }
        return environment
    }

    private static func parseEnvFile(at url: URL) -> [String: String] {
        guard let data = try? Data(contentsOf: url) else { return [:] }
        // Decoded as Node decodes it, so an invalid byte doesn't drop the whole file. Node also
        // ignores a variable with an empty name.
        return parseEnv(String(decoding: data, as: UTF8.self)).filter { !$0.key.isEmpty }
    }

    /// Parses dotenv text as Node 22's `util.parseEnv` does. `@immoradar/config` reads `.env` files
    /// with that parser for npm and tsx commands, so the app and those commands get the same values.
    /// Node's quirks are kept on purpose. `#` starts a comment anywhere in an unquoted value, and a
    /// quoted value can run over several lines. A line with only spaces after `=` takes the next line
    /// as its value.
    static func parseEnv(_ contents: String) -> [String: String] {
        let bytes = contents.utf8.filter { $0 != UInt8(ascii: "\r") }
        let newline = UInt8(ascii: "\n")

        func isBlank(_ byte: UInt8) -> Bool {
            byte == UInt8(ascii: " ") || byte == UInt8(ascii: "\t") || byte == newline
        }
        func trimmed(_ range: Range<Int>) -> Range<Int> {
            var lower = range.lowerBound
            var upper = range.upperBound
            while lower < upper, isBlank(bytes[lower]) { lower += 1 }
            while upper > lower, isBlank(bytes[upper - 1]) { upper -= 1 }
            return lower..<upper
        }
        func firstIndex(of byte: UInt8, in range: Range<Int>) -> Int? {
            range.first { bytes[$0] == byte }
        }
        func text(_ range: Range<Int>) -> String {
            String(decoding: bytes[range], as: UTF8.self)
        }
        // Inside double quotes, `\n` becomes a newline.
        func expandingNewlines(_ range: Range<Int>) -> String {
            var expanded: [UInt8] = []
            var index = range.lowerBound
            while index < range.upperBound {
                if bytes[index] == UInt8(ascii: "\\"), index + 1 < range.upperBound,
                   bytes[index + 1] == UInt8(ascii: "n") {
                    expanded.append(newline)
                    index += 2
                } else {
                    expanded.append(bytes[index])
                    index += 1
                }
            }
            return String(decoding: expanded, as: UTF8.self)
        }

        let exportPrefix = Array("export ".utf8)
        var parsed: [String: String] = [:]
        var content = trimmed(0..<bytes.count)

        while !content.isEmpty {
            // Blank lines and comments.
            if bytes[content.lowerBound] == newline || bytes[content.lowerBound] == UInt8(ascii: "#") {
                let next = firstIndex(of: newline, in: content).map { $0 + 1 } ?? content.upperBound
                content = next..<content.upperBound
                continue
            }

            guard let separator = content.first(where: {
                bytes[$0] == UInt8(ascii: "=") || bytes[$0] == newline
            }) else { break }
            // A line without "=" sets nothing.
            if bytes[separator] == newline {
                content = trimmed((separator + 1)..<content.upperBound)
                continue
            }

            var key = trimmed(content.lowerBound..<separator)
            content = (separator + 1)..<content.upperBound
            if content.isEmpty || bytes[content.lowerBound] == newline {
                parsed[text(key)] = ""
                continue
            }

            content = trimmed(content)
            if key.isEmpty { continue }
            if key.count >= exportPrefix.count,
               bytes[key.lowerBound..<(key.lowerBound + exportPrefix.count)].elementsEqual(exportPrefix) {
                key = trimmed((key.lowerBound + exportPrefix.count)..<key.upperBound)
            }
            if content.isEmpty {
                parsed[text(key)] = ""
                break
            }

            let quote = bytes[content.lowerBound]
            if quote == UInt8(ascii: "\"") || quote == UInt8(ascii: "'") || quote == UInt8(ascii: "`") {
                if let closing = firstIndex(of: quote, in: (content.lowerBound + 1)..<content.upperBound) {
                    let inside = (content.lowerBound + 1)..<closing
                    parsed[text(key)] = quote == UInt8(ascii: "\"") ? expandingNewlines(inside) : text(inside)
                    // The rest of the closing quote's line is ignored.
                    let next = firstIndex(of: newline, in: (closing + 1)..<content.upperBound)
                        .map { $0 + 1 } ?? content.upperBound
                    content = next..<content.upperBound
                    continue
                }
                // Without a closing quote, the value is the rest of the line, quote included.
                guard let lineEnd = firstIndex(of: newline, in: content) else {
                    parsed[text(key)] = text(content)
                    break
                }
                parsed[text(key)] = text(content.lowerBound..<lineEnd)
                content = (lineEnd + 1)..<content.upperBound
            } else {
                let lineEnd = firstIndex(of: newline, in: content)
                var value = content.lowerBound..<(lineEnd ?? content.upperBound)
                if let hash = firstIndex(of: UInt8(ascii: "#"), in: value) {
                    value = value.lowerBound..<hash
                }
                parsed[text(key)] = text(trimmed(value))
                content = (lineEnd.map { $0 + 1 } ?? content.upperBound)..<content.upperBound
            }
            content = trimmed(content)
        }
        return parsed
    }

    // MARK: - Locations

    static func runtimeHomeURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> URL {
        if let override = environment["IMMORADAR_RUNTIME_HOME_OVERRIDE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true).standardizedFileURL
        }
        return homeDirectory.appendingPathComponent("Library/Application Support/ImmoRadar/runtime", isDirectory: true)
    }

    static func logsDirectoryURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> URL {
        if let override = environment["IMMORADAR_LOGS_DIRECTORY_OVERRIDE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true).standardizedFileURL
        }
        return homeDirectory.appendingPathComponent("Library/Logs/ImmoRadar", isDirectory: true)
    }

    // MARK: - Finding a developer checkout

    static func findRepoRuntimeRoot(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        bundleURL: URL = Bundle.main.bundleURL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URL {
        guard environment["IMMORADAR_SMOKE_TEST"] == nil else {
            throw LayoutError.runtimeArtifactsMissing
        }
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

        throw LayoutError.runtimeArtifactsMissing
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

    // MARK: - Finding Node

    static func nodeExecutableCandidates(
        under root: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> [URL] {
        var candidates: [URL] = []

        let overrideKeys = [
            "IMMORADAR_NODE_EXECUTABLE",
            "NODE_BINARY",
        ]
        for key in overrideKeys {
            guard let raw = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !raw.isEmpty else {
                continue
            }

            candidates.append(URL(fileURLWithPath: raw, isDirectory: false))
        }

        candidates += [
            root.appendingPathComponent("node"),
            root.appendingPathComponent("bin/node"),
            root.appendingPathComponent("node/bin/node"),
        ]

        let pathCandidates = (environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
            .filter { !$0.isEmpty }
            .map { URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("node") }
        candidates += pathCandidates

        if let homebrewPrefix = environment["HOMEBREW_PREFIX"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !homebrewPrefix.isEmpty {
            candidates.append(
                URL(fileURLWithPath: homebrewPrefix, isDirectory: true)
                    .appendingPathComponent("bin/node")
            )
        }

        candidates += [
            URL(fileURLWithPath: "/opt/homebrew/bin/node"),
            URL(fileURLWithPath: "/usr/local/bin/node"),
            URL(fileURLWithPath: "/opt/local/bin/node"),
            homeDirectory.appendingPathComponent(".volta/bin/node"),
            homeDirectory.appendingPathComponent(".fnm/current/bin/node"),
            homeDirectory.appendingPathComponent(".asdf/shims/node"),
            homeDirectory.appendingPathComponent(".mise/shims/node"),
            homeDirectory.appendingPathComponent(".local/bin/node"),
        ]

        return orderedUniqueURLs(urls: candidates)
    }

    private static func findNodeExecutable(under root: URL, environment: [String: String]) throws -> URL {
        let homeDirectory = FileManager.default.homeDirectoryForCurrentUser

        for candidate in nodeExecutableCandidates(
            under: root,
            environment: environment,
            homeDirectory: homeDirectory
        ) where FileManager.default.isExecutableFile(atPath: candidate.path) {
            return candidate
        }

        if let shellResolved = resolveNodeExecutableFromUserShell(
            environment: environment,
            homeDirectory: homeDirectory
        ) {
            return shellResolved
        }

        throw LayoutError.nodeExecutableMissing
    }

    private static func resolveNodeExecutableFromUserShell(
        environment: [String: String],
        homeDirectory: URL
    ) -> URL? {
        let preferredShells = orderedUniqueURLs(
            urls: [
                environment["SHELL"]
                    .flatMap { raw -> URL? in
                        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { return nil }
                        return URL(fileURLWithPath: trimmed, isDirectory: false)
                    },
                URL(fileURLWithPath: "/bin/zsh"),
                URL(fileURLWithPath: "/bin/bash"),
            ].compactMap { $0 }
        )

        for shellURL in preferredShells where FileManager.default.isExecutableFile(atPath: shellURL.path) {
            guard let resolvedPath = shellCommandOutput(
                executableURL: shellURL,
                arguments: ["-l", "-c", "command -v node"],
                environment: environment,
                workingDirectory: homeDirectory
            ) else {
                continue
            }

            let lines = resolvedPath
                .split(whereSeparator: \.isNewline)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }

            guard let candidatePath = lines.last, candidatePath.hasPrefix("/") else {
                continue
            }

            let candidateURL = URL(fileURLWithPath: candidatePath, isDirectory: false)
            if FileManager.default.isExecutableFile(atPath: candidateURL.path) {
                return candidateURL
            }
        }

        return nil
    }

    private static func shellCommandOutput(
        executableURL: URL,
        arguments: [String],
        environment: [String: String],
        workingDirectory: URL
    ) -> String? {
        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments
        process.currentDirectoryURL = workingDirectory
        process.environment = environment

        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = Pipe()

        do {
            try process.run()
        } catch {
            return nil
        }

        let deadline = Date.now.addingTimeInterval(3)
        while process.isRunning && Date.now < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }

        if process.isRunning {
            process.terminate()
            Thread.sleep(forTimeInterval: 0.1)
            if process.isRunning {
                process.interrupt()
            }
        }

        let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            return nil
        }

        let output = String(decoding: data, as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return output.isEmpty ? nil : output
    }
}
