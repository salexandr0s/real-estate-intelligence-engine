import Darwin
import Foundation

/// Names the watchdog and children of a run. The watchdog removes this file when it finishes, so
/// finding one at launch means the last run is still stopping or never got to.
struct EngineRunRecord: Codable, Equatable, Sendable {
    let runID: UUID
    let watchdog: ProcessIdentity
    let components: [String: ProcessIdentity]

    static func load(from url: URL) -> EngineRunRecord? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(EngineRunRecord.self, from: data)
    }

    func save(to url: URL) throws {
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
    }
}

struct EngineLeftover: Equatable, Sendable {
    enum Role: Equatable, Sendable {
        case postmaster
        case redis
        case other
    }

    let identity: ProcessIdentity
    let role: Role
}

struct EnginePortHolder: Equatable, Sendable {
    let pid: pid_t
    let executable: String
}

enum PostmasterDecision: Equatable, Sendable {
    /// Postgres clears a file naming a dead PID by itself.
    case leaveFile
    case stopPostgres(pid_t)
    case deleteFile
}

/// Finds what earlier runs left behind. These all read every process on the Mac, so call them off
/// the main actor. Nothing here sends a signal: the watchdog stops what these find.
enum EngineLeftovers {
    static func find(
        runtimeHome: URL,
        recorded: [ProcessIdentity],
        includesUnmarkedWorkers: Bool
    ) -> [EngineLeftover] {
        let marker = "IMMORADAR_ENGINE_HOME=\(runtimeHome.path)/"
        let dataDirectory = dataDirectoryPath(runtimeHome: runtimeHome)
        let redisDirectory = realPath(of: runtimeHome) + "/redis"
        let recordedPostmaster = recordedPostmasterPID(runtimeHome: runtimeHome)
        let ownPID = getpid()

        var leftovers: [EngineLeftover] = []
        for pid in ProcessInspector.allProcessIDs() where pid > 1 && pid != ownPID {
            guard case .live(let identity) = ProcessInspector.observe(pid: pid) else { continue }

            let name = executableName(of: identity)
            if name == "postgres", ProcessInspector.cwd(pid: pid) == dataDirectory {
                // A backend under a live postmaster exits with it. An orphan has no postmaster to
                // stop it, so it counts by itself.
                guard !isChildOfSameServer(pid: pid, name: name, cwd: dataDirectory) else { continue }
                leftovers.append(
                    EngineLeftover(identity: identity, role: pid == recordedPostmaster ? .postmaster : .other)
                )
                continue
            }
            if name == "redis-server", let cwd = ProcessInspector.cwd(pid: pid),
               cwd == redisDirectory || cwd.hasPrefix(redisDirectory + "/") {
                guard !isChildOfSameServer(pid: pid, name: name, cwd: cwd) else { continue }
                leftovers.append(EngineLeftover(identity: identity, role: .redis))
                continue
            }
            if recorded.contains(identity) {
                leftovers.append(EngineLeftover(identity: identity, role: .other))
                continue
            }

            guard let process = ProcessInspector.argumentsAndEnvironment(pid: pid) else { continue }
            if process.environment.contains(marker)
                || (includesUnmarkedWorkers && isUnmarkedWorker(process)) {
                leftovers.append(EngineLeftover(identity: identity, role: .other))
            }
        }
        return leftovers
    }

    /// Postgres refuses to start while `postmaster.pid` names any live process, and after a reboot
    /// that PID can belong to anything. Returns a postgres that has to stop first, if there is one.
    static func clearStalePostmasterFile(runtimeHome: URL) -> pid_t? {
        guard let pid = recordedPostmasterPID(runtimeHome: runtimeHome) else { return nil }

        let dataDirectory = dataDirectoryPath(runtimeHome: runtimeHome)
        let decision = postmasterDecision(
            recorded: ProcessInspector.observe(pid: pid),
            recordedCWD: ProcessInspector.cwd(pid: pid),
            dataDirectory: dataDirectory,
            postgresHoldingData: isPostgresHolding(dataDirectory: dataDirectory)
        )

        switch decision {
        case .leaveFile:
            return nil
        case .stopPostgres(let pid):
            return pid
        case .deleteFile:
            try? FileManager.default.removeItem(at: postmasterFile(runtimeHome: runtimeHome))
            return nil
        }
    }

    static func postmasterDecision(
        recorded: ProcessObservation?,
        recordedCWD: String?,
        dataDirectory: String,
        postgresHoldingData: Bool
    ) -> PostmasterDecision {
        guard case .live(let identity) = recorded else { return .leaveFile }

        if executableName(of: identity) == "postgres", recordedCWD == dataDirectory {
            return .stopPostgres(identity.pid)
        }
        return postgresHoldingData ? .leaveFile : .deleteFile
    }

    static func holder(ofPort port: Int) -> EnginePortHolder? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-Fpc"]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice

        guard (try? process.run()) != nil else { return nil }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        var pid: pid_t?
        var command: String?
        for line in String(decoding: data, as: UTF8.self).split(whereSeparator: \.isNewline) {
            if pid == nil, line.hasPrefix("p") {
                pid = pid_t(line.dropFirst())
            } else if command == nil, line.hasPrefix("c") {
                command = String(line.dropFirst())
            }
        }
        guard let pid else { return nil }

        if case .live(let identity) = ProcessInspector.observe(pid: pid) {
            return EnginePortHolder(pid: pid, executable: identity.executablePath)
        }
        return EnginePortHolder(pid: pid, executable: command ?? "an unknown process")
    }

    private static func executableName(of identity: ProcessIdentity) -> String {
        URL(fileURLWithPath: identity.executablePath).lastPathComponent
    }

    /// The kernel reports a working directory with symlinks resolved, including /private.
    private static func realPath(of url: URL) -> String {
        guard let resolved = realpath(url.path, nil) else { return url.path }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    private static func dataDirectoryPath(runtimeHome: URL) -> String {
        realPath(of: runtimeHome) + "/postgres/data"
    }

    private static func postmasterFile(runtimeHome: URL) -> URL {
        runtimeHome.appendingPathComponent("postgres/data/postmaster.pid", isDirectory: false)
    }

    private static func recordedPostmasterPID(runtimeHome: URL) -> pid_t? {
        guard let contents = try? String(contentsOf: postmasterFile(runtimeHome: runtimeHome), encoding: .utf8),
              let firstLine = contents.split(whereSeparator: \.isNewline).first else {
            return nil
        }
        return pid_t(firstLine.trimmingCharacters(in: .whitespaces))
    }

    private static func isChildOfSameServer(pid: pid_t, name: String, cwd: String) -> Bool {
        guard let parent = ProcessInspector.parentPID(pid: pid), parent > 1,
              case .live(let parentIdentity) = ProcessInspector.observe(pid: parent),
              executableName(of: parentIdentity) == name else {
            return false
        }
        return ProcessInspector.cwd(pid: parent) == cwd
    }

    private static func isPostgresHolding(dataDirectory: String) -> Bool {
        ProcessInspector.allProcessIDs().contains { pid in
            guard case .live(let identity) = ProcessInspector.observe(pid: pid),
                  executableName(of: identity) == "postgres" else {
                return false
            }
            return ProcessInspector.cwd(pid: pid) == dataDirectory
        }
    }

    /// Engines from before the home marker existed run the same entry points without it.
    private static func isUnmarkedWorker(_ process: (arguments: [String], environment: [String])) -> Bool {
        guard let entry = process.arguments.last,
              entry.hasSuffix("/dist/main.js"), entry.contains("/apps/") else {
            return false
        }
        return process.environment.contains { $0.hasPrefix("IMMORADAR_RUNTIME_BOOT_MODE=") }
            && !process.environment.contains { $0.hasPrefix("IMMORADAR_ENGINE_HOME=") }
    }
}
