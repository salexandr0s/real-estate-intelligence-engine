import AppKit
import Darwin

/// One engine per user, because Debug and Release share a database, queues and ports. The kernel
/// drops the lock when its holder dies, however that happens, so a stale file can't block a launch.
enum EngineInstanceLock {
    enum Outcome: Equatable {
        /// The descriptor stays open for the life of the process, which is what holds the lock.
        case acquired(Int32)
        case heldByApp(pid_t)
        case heldByTool(pid_t?)
        case unavailable(errno: Int32)
    }

    /// A holder writes its PID just after it gets the lock, so a read can briefly see the last one.
    private static let holderReadAttempts = 4
    private static let holderReadDelayMicroseconds: UInt32 = 50_000

    /// Resetting the engine deletes the runtime home, so the file lives beside it.
    static func url(runtimeHome: URL) -> URL {
        runtimeHome.deletingLastPathComponent().appendingPathComponent("engine.lock", isDirectory: false)
    }

    static func acquire(at url: URL, appExecutableName: String) -> Outcome {
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let descriptor = open(url.path, O_CREAT | O_RDWR | O_EXLOCK | O_NONBLOCK | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else {
            guard errno == EWOULDBLOCK else { return .unavailable(errno: errno) }
            return holder(of: url, appExecutableName: appExecutableName)
        }

        ftruncate(descriptor, 0)
        let contents = "\(getpid())\n"
        _ = contents.withCString { write(descriptor, $0, strlen($0)) }
        return .acquired(descriptor)
    }

    private static func holder(of url: URL, appExecutableName: String) -> Outcome {
        var livePID: pid_t?
        for attempt in 0..<holderReadAttempts {
            if attempt > 0 { usleep(holderReadDelayMicroseconds) }

            livePID = nil
            guard let contents = try? String(contentsOf: url, encoding: .utf8),
                  let pid = pid_t(contents.trimmingCharacters(in: .whitespacesAndNewlines)),
                  case .live(let identity) = ProcessInspector.observe(pid: pid) else {
                continue
            }

            if URL(fileURLWithPath: identity.executablePath).lastPathComponent == appExecutableName {
                return .heldByApp(pid)
            }
            livePID = pid
        }
        return .heldByTool(livePID)
    }

    /// Takes the lock, or ends this launch. Runs before anything can touch the engine, and signals
    /// nothing: the instance that holds the lock keeps running untouched.
    @MainActor
    static func acquireOrExit() {
        let url = url(runtimeHome: LocalRuntimeService.runtimeHomeURL)
        let executableName = Bundle.main.executableURL?.lastPathComponent ?? "ImmoRadar"

        switch acquire(at: url, appExecutableName: executableName) {
        case .acquired:
            return
        case .unavailable(let code):
            // The engine can't write here either, so its own start reports the problem to the user.
            let reason = String(cString: strerror(code))
            Log.engine.error("Couldn't open the engine lock: \(reason, privacy: .public)")
        case .heldByApp(let pid):
            let path: String
            if case .live(let identity) = ProcessInspector.observe(pid: pid) {
                path = identity.executablePath
            } else {
                path = "another location"
            }
            FileHandle.standardError.write(Data("ImmoRadar is already running from \(path) (PID \(pid)).\n".utf8))
            NSRunningApplication(processIdentifier: pid)?.activate()
            exit(0)
        case .heldByTool:
            let alert = NSAlert()
            alert.messageText = "ImmoRadar can’t open yet"
            alert.informativeText = "A database import is using the local engine. Open ImmoRadar again once it finishes."
            alert.runModal()
            exit(0)
        }
    }
}
