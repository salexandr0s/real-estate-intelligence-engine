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
            // Without the lock, a second launch could stop this one's engine, so this launch ends here.
            let reason = String(cString: strerror(code))
            Log.engine.error("Couldn't open the engine lock: \(reason, privacy: .public)")
            showAlertAndExit(
                title: "ImmoRadar can’t open",
                detail: "It couldn’t open \(url.path): \(reason). Check that your account can write to this file, then open ImmoRadar again.",
                status: 1
            )
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
            showAlertAndExit(
                title: "ImmoRadar can’t open yet",
                detail: "A database import is using the local engine. Open ImmoRadar again once it finishes.",
                status: 0
            )
        }
    }

    @MainActor
    private static func showAlertAndExit(title: String, detail: String, status: Int32) -> Never {
        // This runs before the app has finished launching, so nothing has brought it forward yet.
        NSApplication.shared.activate()
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.runModal()
        exit(status)
    }
}
