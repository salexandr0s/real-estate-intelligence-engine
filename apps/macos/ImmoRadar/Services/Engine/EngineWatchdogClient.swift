import Darwin
import Foundation

/// Every process the watchdog can stop. The raw values are its command protocol.
enum EngineSlot: String, CaseIterable, Codable, Sendable {
    case oneshot
    case workerProcessing = "worker-processing"
    case workerScraper = "worker-scraper"
    case api
    case redis
    case postgres
    case leftover
}

/// Holds the pipe to `engine-watchdog.sh`. When the app dies for any reason the kernel closes the
/// pipe, and the script stops the engine, so quitting needs no code here.
@MainActor
final class EngineWatchdogClient {
    enum ClientError: LocalizedError {
        case notRunning
        case didNotStart
        case writeFailed(Int32)

        var errorDescription: String? {
            switch self {
            case .notRunning, .didNotStart:
                return "The engine watchdog isn’t running."
            case .writeFailed(let code):
                return "Couldn’t reach the engine watchdog (\(String(cString: strerror(code))))."
            }
        }
    }

    var onUnexpectedExit: (@MainActor (Int32) -> Void)?

    private let scriptURL: URL
    private let runtimeHome: URL
    private let logFile: URL
    private var process: Process?
    private var pipe: Pipe?
    private var isClosing = false
    private var exitWaiters: [UUID: CheckedContinuation<Bool, Never>] = [:]

    init(scriptURL: URL, runtimeHome: URL, logFile: URL) {
        self.scriptURL = scriptURL
        self.runtimeHome = runtimeHome
        self.logFile = logFile
    }

    func start(runID: UUID) throws -> ProcessIdentity {
        let pipe = Pipe()
        let writeDescriptor = pipe.fileHandleForWriting.fileDescriptor
        // Close-on-exec keeps the write end out of every child, because one child holding it would
        // stop the pipe from closing when the app dies. No SIGPIPE, so a dead watchdog is an error
        // from write and can't kill the app, and non-blocking, so a stuck one can't freeze the UI.
        _ = fcntl(writeDescriptor, F_SETFD, FD_CLOEXEC)
        _ = fcntl(writeDescriptor, F_SETNOSIGPIPE, 1)
        _ = fcntl(writeDescriptor, F_SETFL, O_NONBLOCK)

        let log = try EngineLogs.openForAppend(logFile)
        defer { try? log.close() }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptURL.path]
        process.environment = [
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "IMMORADAR_WATCHDOG_RUNTIME_HOME": runtimeHome.path,
        ]
        process.standardInput = pipe.fileHandleForReading
        process.standardOutput = log
        process.standardError = log
        process.qualityOfService = .utility
        process.terminationHandler = { [weak self] terminated in
            let status = terminated.terminationStatus
            Task { @MainActor [weak self] in
                self?.handleExit(of: terminated, status: status)
            }
        }

        try process.run()
        // With the parent's read end gone, a write after the watchdog dies fails with EPIPE.
        try? pipe.fileHandleForReading.close()

        self.process = process
        self.pipe = pipe
        isClosing = false

        guard case .live(let identity) = ProcessInspector.observe(pid: process.processIdentifier) else {
            throw ClientError.didNotStart
        }
        try send("RUN \(runID.uuidString)")
        return identity
    }

    func add(_ slot: EngineSlot, generation: Int, pid: pid_t) throws {
        try send("ADD \(slot.rawValue) \(generation) \(pid)")
    }

    func remove(_ slot: EngineSlot) throws {
        try send("DEL \(slot.rawValue)")
    }

    /// There is no reply. The app learns about each exit from its own termination handlers.
    func stop(_ slots: [EngineSlot]) throws {
        guard !slots.isEmpty else { return }
        try send("STOP \(slots.map(\.rawValue).joined(separator: " "))")
    }

    /// Runs the same stop as an app death, and waits for it. A watchdog still running at the
    /// timeout is hung, so it gets SIGKILL.
    func closeAndWait(timeout: Duration) async -> Bool {
        guard let process else { return true }

        isClosing = true
        closeWriteEnd()

        var exited = await waitForExit(of: process, timeout: timeout)
        if !exited, case .live = ProcessInspector.observe(pid: process.processIdentifier) {
            kill(process.processIdentifier, SIGKILL)
            exited = await waitForExit(of: process, timeout: .seconds(1))
        }
        self.process = nil
        return exited
    }

    private func handleExit(of terminated: Process, status: Int32) {
        for (_, waiter) in exitWaiters {
            waiter.resume(returning: true)
        }
        exitWaiters.removeAll()

        guard process === terminated, !isClosing else { return }
        process = nil
        closeWriteEnd()
        onUnexpectedExit?(status)
    }

    private func waitForExit(of process: Process, timeout: Duration) async -> Bool {
        guard process.isRunning else { return true }

        return await withCheckedContinuation { continuation in
            let id = UUID()
            exitWaiters[id] = continuation
            Task { [weak self] in
                try? await Task.sleep(for: timeout)
                self?.exitWaiters.removeValue(forKey: id)?.resume(returning: false)
            }
        }
    }

    private func closeWriteEnd() {
        try? pipe?.fileHandleForWriting.close()
        pipe = nil
    }

    private func send(_ command: String) throws {
        guard let pipe, process != nil else { throw ClientError.notRunning }

        let line = Array((command + "\n").utf8)
        var offset = 0
        while offset < line.count {
            let written = line[offset...].withUnsafeBytes { raw in
                Darwin.write(pipe.fileHandleForWriting.fileDescriptor, raw.baseAddress, raw.count)
            }
            if written < 0 {
                if errno == EINTR { continue }
                throw ClientError.writeFailed(errno)
            }
            offset += written
        }
    }
}
