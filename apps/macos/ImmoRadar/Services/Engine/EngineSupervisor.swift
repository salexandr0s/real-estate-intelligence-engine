import Darwin
import Foundation

extension EngineSlot {
    var logFileName: String {
        switch self {
        case .oneshot: return "migrations.log"
        case .workerProcessing: return "worker-processing.log"
        case .workerScraper: return "worker-scraper.log"
        case .api: return "api.log"
        case .redis: return "redis.log"
        case .postgres: return "postgres.log"
        case .leftover: return EngineSupervisor.watchdogLogFileName
        }
    }

    var displayName: String {
        switch self {
        case .oneshot: return "A setup step"
        case .workerProcessing: return "Processing"
        case .workerScraper: return "Scraper"
        case .api: return "The local API"
        case .redis: return "Redis"
        case .postgres: return "Postgres"
        case .leftover: return "A leftover process"
        }
    }

    var startingStep: EngineStartupStep? {
        switch self {
        case .postgres: return .startingPostgres
        case .redis: return .startingRedis
        case .api: return .startingAPI
        case .workerProcessing: return .startingProcessingWorker
        case .workerScraper: return .startingScraperWorker
        case .oneshot, .leftover: return nil
        }
    }

    /// Crawling belongs on the efficiency cores, and a fanless Mac should stay cool under it.
    var qualityOfService: QualityOfService {
        switch self {
        case .workerProcessing, .workerScraper: return .background
        case .oneshot, .api, .redis, .postgres, .leftover: return .utility
        }
    }

    fileprivate static let workers: [EngineSlot] = [.workerProcessing, .workerScraper]

    fileprivate var isWorker: Bool {
        Self.workers.contains(self)
    }
}

/// Runs the engine's processes through one watchdog. The app's death stops them without any code
/// here running, so this only starts things, reacts to exits and asks the watchdog to stop them.
@MainActor
final class EngineSupervisor {
    enum Event {
        case progress(title: String, detail: String, fraction: Double?)
        case step(EngineStartupStep)
        case componentsChanged
        case degraded(String)
        case failed(EngineStartupFailure)
        case coreServiceExited(EngineSlot, status: Int32)
    }

    private struct Child {
        let process: Process
        let generation: Int
    }

    private enum Phase {
        case idle
        case starting
        case running
        case stopping
    }

    nonisolated static let watchdogLogFileName = "engine-watchdog.log"
    private static let repoBuildLogFileName = "runtime-bootstrap.log"
    private static let restartDelays: [Duration] = [.seconds(1), .seconds(5), .seconds(30)]
    private static let restartWindow: TimeInterval = 300
    private static let watchdogDeathWindow: TimeInterval = 60
    private static let watchdogDeathLimit = 3
    private static let watchdogStopBound: Duration = .seconds(40)
    /// Longer than the watchdog's worker rung: 10 seconds, then SIGKILL and its sweep.
    private static let workerStopBound: Duration = .seconds(15)
    private static let healthInterval: Duration = .seconds(30)
    private static let healthFailureLimit = 3
    private static let healthChecksPerRotation = 120
    private static let bash = URL(fileURLWithPath: "/bin/bash")

    var onEvent: ((Event) -> Void)?

    private var phase: Phase = .idle
    private var layout: EngineLayout?
    private var token = ""
    private var runID = UUID()
    private var watchdog: EngineWatchdogClient?
    private var watchdogIdentity: ProcessIdentity?
    private var writtenRecord: EngineRunRecord?
    private var children: [EngineSlot: Child] = [:]
    private var generations: [EngineSlot: Int] = [:]
    private var lastExitStatus: [EngineSlot: Int32] = [:]
    private var workersWanted = false
    private var workerTransition: Task<Void, Never>?
    private var restartHistory: [EngineSlot: [Date]] = [:]
    private var restartTasks: [EngineSlot: Task<Void, Never>] = [:]
    private var watchdogDeaths: [Date] = []
    private var watchdogRetry: Task<Void, Never>?
    private var healthTask: Task<Void, Never>?
    private var stopTask: Task<Void, Never>?

    /// True from the moment a start begins until `stop()` returns.
    var isActive: Bool { phase != .idle }

    var isRunning: Bool { phase == .running }

    var runningPIDs: [EngineSlot: pid_t] {
        children.compactMapValues { $0.process.isRunning ? $0.process.processIdentifier : nil }
    }

    /// False while something the engine should be running is down, which is what degraded means.
    var hasEveryWantedProcess: Bool {
        let wanted: [EngineSlot] = [.postgres, .redis, .api] + (workersWanted ? EngineSlot.workers : [])
        return wanted.allSatisfy { children[$0]?.process.isRunning == true }
    }

    // MARK: - Starting

    func start(layout: EngineLayout, token: String, monitoring: Bool) async throws {
        await stop()

        phase = .starting
        self.layout = layout
        self.token = token
        runID = UUID()
        workersWanted = monitoring
        restartHistory.removeAll()
        watchdogDeaths.removeAll()
        lastExitStatus.removeAll()

        report(.step(.preparingStorage))
        report(.progress(
            title: "Preparing local storage",
            detail: "Creating the runtime directories for data, logs, and artifacts.",
            fraction: 0.08
        ))
        try createDirectories(layout)

        let prior = EngineRunRecord.load(from: layout.runRecordFile)
        await waitForPriorWatchdog(prior)
        try startWatchdog(layout)
        try await stopLeftovers(layout, prior: prior)
        try await requireFreePorts(layout)
        await rotateLogs(in: layout.logsDirectory, largerThan: EngineLogs.rotationLimitAtStart)

        try await buildRepoRuntimeIfNeeded(layout)
        try await launchPostgres(layout)
        try await launchRedis(layout)
        try await applyMigrations(layout)
        try await launchAPI(layout)
        let startedWorkers = workersWanted
        if startedWorkers {
            report(.step(.startingProcessingWorker))
            report(.progress(
                title: "Starting workers",
                detail: "Enabling ingestion, scoring, and the scraper queues.",
                fraction: 0.92
            ))
            try launchWorkers(layout)
        }

        report(.step(.verifyingServices))
        try? await Task.sleep(for: .milliseconds(600))
        guard phase == .starting else {
            throw EngineStartupFailure.unexpected("The engine stopped while it was starting.")
        }
        // Each process is checked here because nothing else reports an exit during a start. Postgres
        // and Redis can die after their readiness wait, and the API's static /health wouldn't notice.
        try requireRunning(.postgres)
        try requireRunning(.redis)
        try requireRunning(.api)
        if startedWorkers {
            try requireRunning(.workerProcessing)
            try requireRunning(.workerScraper)
        }

        phase = .running
        startHealthLoop(layout)
        // Monitoring may have paused, or a hold may have begun, while the engine was starting.
        if workersWanted != startedWorkers {
            await convergeWorkers()
        }
    }

    // MARK: - Workers

    /// Paused monitoring means no worker processes. Postgres, Redis and the API stay up. Only the
    /// latest request counts, and a change never overlaps the one before it.
    func setWorkersRunning(_ running: Bool) async {
        guard running != workersWanted else { return }
        workersWanted = running
        await convergeWorkers()
    }

    private func convergeWorkers() async {
        if let workerTransition {
            await workerTransition.value
            return
        }
        guard phase == .running else { return }

        let task = Task { [weak self] in
            guard let self else { return }
            await self.runWorkerTransitions()
        }
        workerTransition = task
        await task.value
    }

    private func runWorkerTransitions() async {
        defer { workerTransition = nil }

        var applied: Bool?
        while phase == .running, let layout, applied != workersWanted {
            let running = workersWanted
            applied = running

            for slot in EngineSlot.workers {
                restartTasks[slot]?.cancel()
                restartTasks[slot] = nil
                restartHistory[slot] = nil
            }

            if running {
                do {
                    try launchWorkers(layout)
                } catch {
                    report(.degraded(error.localizedDescription))
                }
            } else {
                let processes = EngineSlot.workers.compactMap { children[$0]?.process }
                if !processes.isEmpty {
                    tellWatchdog { try $0.stop(EngineSlot.workers) }
                    await waitForExit(of: processes, timeout: Self.workerStopBound)
                }
            }
        }
    }

    // MARK: - Stopping

    /// Runs the same stop as an app death, and returns once it has finished. A second caller joins
    /// the stop in progress, so nothing can start while an earlier stop is still finishing.
    func stop() async {
        if let stopTask {
            await stopTask.value
            return
        }
        guard phase != .idle else { return }

        phase = .stopping
        healthTask?.cancel()
        healthTask = nil
        for task in restartTasks.values {
            task.cancel()
        }
        restartTasks.removeAll()
        watchdogRetry?.cancel()
        watchdogRetry = nil

        let closing = watchdog
        // With no watchdog to close, only the app can end its children.
        let unwatched = closing == nil ? children.values.map(\.process).filter(\.isRunning) : []
        unwatched.forEach { $0.terminate() }

        let task = Task { [weak self] in
            if let closing {
                _ = await closing.closeAndWait(timeout: Self.watchdogStopBound)
            } else {
                await self?.waitForExit(of: unwatched, timeout: Self.watchdogStopBound)
            }
            self?.finishStopping()
        }
        stopTask = task
        await task.value
    }

    private func finishStopping() {
        watchdog = nil
        watchdogIdentity = nil
        writtenRecord = nil
        children.removeAll()
        stopTask = nil
        phase = .idle
        report(.componentsChanged)
    }

    /// Stops whatever earlier runs left, without starting an engine.
    func stopLeftoversOnly(layout: EngineLayout) async throws {
        guard phase == .idle else { return }

        phase = .stopping
        self.layout = layout
        runID = UUID()
        do {
            try createDirectories(layout)
            let prior = EngineRunRecord.load(from: layout.runRecordFile)
            await waitForPriorWatchdog(prior)
            try startWatchdog(layout)
            try await stopLeftovers(layout, prior: prior)
        } catch {
            await stop()
            throw error
        }
        await stop()
    }

    private func createDirectories(_ layout: EngineLayout) throws {
        for directory in [
            layout.runtimeHome,
            layout.runtimeHome.appendingPathComponent("artifacts", isDirectory: true),
            layout.runtimeHome.appendingPathComponent("logs", isDirectory: true),
            layout.logsDirectory,
        ] {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }

    // MARK: - Watchdog

    private func startWatchdog(_ layout: EngineLayout) throws {
        guard FileManager.default.fileExists(atPath: layout.watchdogScript.path) else {
            throw EngineStartupFailure(layoutError: .runtimeArtifactsMissing)
        }

        let client = EngineWatchdogClient(
            scriptURL: layout.watchdogScript,
            runtimeHome: layout.runtimeHome,
            logFile: layout.logsDirectory.appendingPathComponent(Self.watchdogLogFileName)
        )
        client.onUnexpectedExit = { [weak self] _ in
            self?.handleWatchdogExit()
        }

        do {
            watchdogIdentity = try client.start(runID: runID)
        } catch {
            throw EngineStartupFailure(
                code: .watchdogUnavailable,
                message: "Couldn’t start the engine watchdog: \(error.localizedDescription)",
                step: .preparingStorage,
                logFileName: Self.watchdogLogFileName
            )
        }
        watchdog = client
        writeRunRecord()
    }

    /// One that outlives its stop bound is hung, so it gets SIGKILL. Its children then count as
    /// leftovers.
    private func waitForPriorWatchdog(_ prior: EngineRunRecord?) async {
        guard let identity = prior?.watchdog else { return }
        guard !(await waitUntilGone([identity], timeout: Self.watchdogStopBound)) else { return }

        if ProcessInspector.observe(pid: identity.pid) == .live(identity) {
            kill(identity.pid, SIGKILL)
        }
        _ = await waitUntilGone([identity], timeout: .seconds(1))
    }

    private func handleWatchdogExit() {
        // The old client takes no more commands. Clearing it first means a failed replacement leaves
        // nil here, and a later stop knows there is no watchdog to close.
        watchdog = nil
        guard phase == .starting || phase == .running, let layout else { return }

        let now = Date.now
        watchdogDeaths = watchdogDeaths.filter { now.timeIntervalSince($0) < Self.watchdogDeathWindow } + [now]

        do {
            try startWatchdog(layout)
            for (slot, child) in children where child.process.isRunning {
                try watchdog?.add(slot, generation: child.generation, pid: child.process.processIdentifier)
            }
            // The dead watchdog may have lost a stop that was on its way to it.
            if !workersWanted, EngineSlot.workers.contains(where: { children[$0]?.process.isRunning == true }) {
                try watchdog?.stop(EngineSlot.workers)
            }
        } catch {
            // A new client that fails on a send reports its own exit, and this runs again.
            Log.engine.error("Couldn't replace the engine watchdog: \(error.localizedDescription, privacy: .public)")
        }

        guard watchdogDeaths.count < Self.watchdogDeathLimit else {
            Task { [weak self] in
                await self?.stop()
                self?.report(.failed(EngineStartupFailure(
                    code: .watchdogUnavailable,
                    message: "The engine watchdog kept exiting, so ImmoRadar stopped the engine. Check ~/Library/Logs/ImmoRadar/\(Self.watchdogLogFileName).",
                    logFileName: Self.watchdogLogFileName
                )))
            }
            return
        }

        // Nothing else calls back when a watchdog can't even start.
        if watchdog == nil {
            watchdogRetry?.cancel()
            watchdogRetry = Task { [weak self] in
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled, let self, self.watchdog == nil else { return }
                self.handleWatchdogExit()
            }
        }
    }

    /// A send fails only while the watchdog is dead. Its replacement takes over every running child
    /// and reruns a lost worker stop.
    private func tellWatchdog(_ command: (EngineWatchdogClient) throws -> Void) {
        guard let watchdog else { return }
        do {
            try command(watchdog)
        } catch {
            Log.engine.error("Engine watchdog command failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func writeRunRecord() {
        guard let layout, let watchdogIdentity else { return }

        var components: [String: ProcessIdentity] = [:]
        for (slot, child) in children {
            if case .live(let identity) = ProcessInspector.observe(pid: child.process.processIdentifier) {
                components[slot.rawValue] = identity
            }
        }

        let record = EngineRunRecord(runID: runID, watchdog: watchdogIdentity, components: components)
        guard record != writtenRecord else { return }
        do {
            try record.save(to: layout.runRecordFile)
            writtenRecord = record
        } catch {
            Log.engine.error("Couldn't write the engine run record: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Leftovers and ports

    private func stopLeftovers(_ layout: EngineLayout, prior: EngineRunRecord?) async throws {
        var leftovers = await findLeftovers(layout, prior: prior)
        var passes = 0
        while !leftovers.isEmpty, passes < 2 {
            passes += 1
            Log.engine.info("Stopping \(leftovers.count) leftover engine processes")
            for leftover in leftovers where ProcessInspector.observe(pid: leftover.identity.pid) == .live(leftover.identity) {
                let slot: EngineSlot = switch leftover.role {
                case .postmaster: .postgres
                case .redis: .redis
                case .other: .leftover
                }
                tellWatchdog { try $0.add(slot, generation: 0, pid: leftover.identity.pid) }
            }
            tellWatchdog { try $0.stop([.leftover, .redis, .postgres]) }
            _ = await waitUntilGone(leftovers.map(\.identity), timeout: Self.watchdogStopBound)
            leftovers = await findLeftovers(layout, prior: prior)
        }

        let home = layout.runtimeHome
        let postgresToStop = await Task.detached(priority: .utility) {
            EngineLeftovers.clearStalePostmasterFile(runtimeHome: home)
        }.value

        let remaining = leftovers.map(\.identity.pid) + (postgresToStop.map { [$0] } ?? [])
        guard remaining.isEmpty else {
            let list = remaining.map(String.init).joined(separator: ", ")
            throw EngineStartupFailure(
                code: .leftoverProcessesRunning,
                message: "Processes from an earlier run didn’t stop (PID \(list)). Check ~/Library/Logs/ImmoRadar/\(Self.watchdogLogFileName).",
                step: .preparingStorage,
                logFileName: Self.watchdogLogFileName
            )
        }
    }

    private func findLeftovers(_ layout: EngineLayout, prior: EngineRunRecord?) async -> [EngineLeftover] {
        let home = layout.runtimeHome
        let recorded = prior.map { Array($0.components.values) } ?? []
        let includesUnmarkedWorkers = ProcessInfo.processInfo.environment["IMMORADAR_SMOKE_TEST"] == nil
        return await Task.detached(priority: .utility) {
            EngineLeftovers.find(
                runtimeHome: home,
                recorded: recorded,
                includesUnmarkedWorkers: includesUnmarkedWorkers
            )
        }.value
    }

    private func requireFreePorts(_ layout: EngineLayout) async throws {
        let services: [(name: String, port: Int, step: EngineStartupStep)] = [
            ("Postgres", layout.ports.postgres, .startingPostgres),
            ("Redis", layout.ports.redis, .startingRedis),
            ("the API", layout.ports.api, .startingAPI),
        ]

        for service in services {
            let port = service.port
            let holder = await Task.detached(priority: .utility) {
                EngineLeftovers.holder(ofPort: port)
            }.value
            if let holder {
                throw EngineStartupFailure(
                    code: .portInUse,
                    message: "Can’t start \(service.name). Port \(port) is in use by \(holder.executable) (PID \(holder.pid)). Quit that process and try again.",
                    step: service.step
                )
            }
        }
    }

    private func rotateLogs(in directory: URL, largerThan limit: UInt64) async {
        await Task.detached(priority: .utility) {
            EngineLogs.rotate(in: directory, largerThan: limit)
        }.value
    }

    // MARK: - Launching

    private func buildRepoRuntimeIfNeeded(_ layout: EngineLayout) async throws {
        guard layout.usesRepoBuild else { return }

        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: layout.nodeModulesDirectory.path) else {
            throw EngineStartupFailure(
                code: .repoBootstrapDependenciesMissing,
                message: "Developer runtime dependencies are missing. Run `npm ci` in the repo root, then retry.",
                step: .bootstrappingRepoRuntime
            )
        }
        guard fileManager.fileExists(atPath: layout.turboScript.path) else {
            throw EngineStartupFailure(
                code: .repoBootstrapToolMissing,
                message: "ImmoRadar couldn’t find the local build toolchain. Reinstall workspace dependencies with `npm ci`, then retry.",
                step: .bootstrappingRepoRuntime
            )
        }

        report(.step(.bootstrappingRepoRuntime))
        report(.progress(
            title: "Preparing developer runtime",
            detail: "Building local API and worker artifacts for this Debug install.",
            fraction: 0.16
        ))

        let status = try await runOneShot(
            executable: layout.nodeExecutable,
            arguments: [
                layout.turboScript.path,
                "run",
                "build",
                "--filter=@immoradar/api",
                "--filter=@immoradar/worker-processing",
                "--filter=@immoradar/worker-scraper",
            ],
            logFileName: Self.repoBuildLogFileName,
            timeout: .seconds(180),
            layout: layout
        )
        guard status != 0 else { return }

        guard EngineLayout.hasRepoRuntimeArtifacts(at: layout.runtimeRoot) else {
            throw EngineStartupFailure(
                code: .repoBootstrapFailed,
                message: "ImmoRadar found the developer runtime source but couldn’t build it. Check ~/Library/Logs/ImmoRadar/\(Self.repoBuildLogFileName).",
                step: .bootstrappingRepoRuntime,
                logFileName: Self.repoBuildLogFileName,
                exitCode: status
            )
        }
        Log.engine.warning("The developer runtime build failed, so the engine is starting from the existing build")
    }

    private func launchPostgres(_ layout: EngineLayout) async throws {
        report(.step(.startingPostgres))
        report(.progress(
            title: "Starting Postgres",
            detail: "Bootstrapping the local database for ImmoRadar.",
            fraction: 0.28
        ))
        try spawn(.postgres, executable: Self.bash, arguments: [layout.postgresScript.path], layout: layout)

        report(.step(.waitingForPostgres))
        try await waitUntilReady(
            .postgres,
            timeout: .seconds(60),
            timedOut: EngineStartupFailure(
                code: .postgresStartupTimedOut,
                message: "Postgres didn’t become ready in time.",
                step: .waitingForPostgres,
                logFileName: EngineSlot.postgres.logFileName,
                slot: .postgres,
                isTransient: true
            )
        ) {
            await Self.isPostgresReady(layout)
        }
    }

    private func launchRedis(_ layout: EngineLayout) async throws {
        report(.step(.startingRedis))
        report(.progress(
            title: "Starting Redis",
            detail: "Bringing up the local queue and scheduler store.",
            fraction: 0.44
        ))
        try spawn(.redis, executable: Self.bash, arguments: [layout.redisScript.path], layout: layout)

        report(.step(.waitingForRedis))
        let port = layout.ports.redis
        try await waitUntilReady(
            .redis,
            timeout: .seconds(20),
            timedOut: EngineStartupFailure(
                code: .redisStartupTimedOut,
                message: "Redis didn’t become ready in time.",
                step: .waitingForRedis,
                logFileName: EngineSlot.redis.logFileName,
                slot: .redis,
                isTransient: true
            )
        ) {
            await Self.isTCPPortOpen(host: "127.0.0.1", port: port)
        }
    }

    private func applyMigrations(_ layout: EngineLayout) async throws {
        let logFileName = EngineSlot.oneshot.logFileName
        report(.step(.applyingMigrations))
        report(.progress(
            title: "Applying database migrations",
            detail: "Creating the ImmoRadar database and applying the schema.",
            fraction: 0.58
        ))

        let timeoutSeconds = 120
        let status = try await runOneShot(
            executable: Self.bash,
            arguments: [layout.migrateScript.path],
            logFileName: logFileName,
            timeout: .seconds(timeoutSeconds),
            layout: layout
        )

        switch status {
        case 0:
            return
        case nil:
            throw EngineStartupFailure(
                code: .migrationsTimedOut,
                message: "Migrations timed out after \(timeoutSeconds) seconds. Check ~/Library/Logs/ImmoRadar/\(logFileName).",
                step: .applyingMigrations,
                logFileName: logFileName
            )
        case 70:
            throw EngineStartupFailure(
                code: .migrationsDatabaseUnavailable,
                message: "The local database was not ready for migrations yet. ImmoRadar will retry automatically.",
                step: .applyingMigrations,
                logFileName: logFileName,
                slot: .postgres,
                exitCode: status,
                isTransient: true
            )
        default:
            throw EngineStartupFailure(
                code: .migrationsFailed,
                message: "Migrations failed. Check ~/Library/Logs/ImmoRadar/\(logFileName).",
                step: .applyingMigrations,
                logFileName: logFileName,
                exitCode: status
            )
        }
    }

    private func launchAPI(_ layout: EngineLayout) async throws {
        report(.step(.startingAPI))
        report(.progress(
            title: "Starting API",
            detail: "Launching the local ImmoRadar API and waiting for health checks.",
            fraction: 0.74
        ))
        try spawnNode(.api, entry: layout.apiEntry, layout: layout)

        report(.step(.waitingForAPI))
        let baseURL = layout.apiBaseURL
        try await waitUntilReady(
            .api,
            timeout: .seconds(20),
            timedOut: EngineStartupFailure(
                code: .apiStartupTimedOut,
                message: "The local API didn’t become healthy in time.",
                step: .waitingForAPI,
                logFileName: EngineSlot.api.logFileName,
                slot: .api,
                isTransient: true
            )
        ) {
            await Self.isAPIHealthy(baseURL: baseURL)
        }
    }

    /// A worker whose exit hasn't been handled yet counts as gone, because `handleExit` ignores the
    /// old generation once a new one has its slot.
    private func launchWorkers(_ layout: EngineLayout) throws {
        if children[.workerProcessing]?.process.isRunning != true {
            try spawnNode(.workerProcessing, entry: layout.processingEntry, layout: layout)
        }
        if children[.workerScraper]?.process.isRunning != true {
            try spawnNode(.workerScraper, entry: layout.scraperEntry, layout: layout)
        }
    }

    private func spawnNode(_ slot: EngineSlot, entry: URL, layout: EngineLayout) throws {
        guard FileManager.default.fileExists(atPath: entry.path) else {
            throw EngineStartupFailure(layoutError: .runtimeArtifactsMissing)
        }
        try spawn(slot, executable: layout.nodeExecutable, arguments: [entry.path], layout: layout)
    }

    @discardableResult
    private func spawn(
        _ slot: EngineSlot,
        executable: URL,
        arguments: [String],
        logFileName: String? = nil,
        layout: EngineLayout
    ) throws -> Process {
        // A stop that began during an await must not leave a child no watchdog knows about.
        guard phase == .starting || phase == .running else {
            throw EngineStartupFailure.unexpected("The engine stopped while it was starting.")
        }

        let logFileName = logFileName ?? slot.logFileName
        let generation = generations[slot, default: 0] + 1
        generations[slot] = generation

        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = layout.runtimeRoot
        process.environment = layout.environment(slot: slot, generation: generation, runID: runID, token: token)
        process.standardInput = FileHandle.nullDevice
        process.qualityOfService = slot.qualityOfService
        process.terminationHandler = { [weak self] terminated in
            let status = terminated.terminationStatus
            Task { @MainActor [weak self] in
                self?.handleExit(of: slot, generation: generation, status: status)
            }
        }

        do {
            let log = try EngineLogs.openForAppend(layout.logsDirectory.appendingPathComponent(logFileName))
            defer { try? log.close() }
            process.standardOutput = log
            process.standardError = log
            try process.run()
        } catch {
            Log.engine.error("Couldn't launch \(slot.rawValue, privacy: .public): \(error.localizedDescription, privacy: .public)")
            throw EngineStartupFailure.launchFailed(slot, logFileName: logFileName)
        }

        children[slot] = Child(process: process, generation: generation)
        tellWatchdog { try $0.add(slot, generation: generation, pid: process.processIdentifier) }
        writeRunRecord()
        report(.componentsChanged)
        return process
    }

    /// Returns the exit status, or nil if the process ran past its timeout and got stopped.
    private func runOneShot(
        executable: URL,
        arguments: [String],
        logFileName: String,
        timeout: Duration,
        layout: EngineLayout
    ) async throws -> Int32? {
        let process = try spawn(
            .oneshot,
            executable: executable,
            arguments: arguments,
            logFileName: logFileName,
            layout: layout
        )

        await waitForExit(of: [process], timeout: timeout)
        guard !process.isRunning else {
            tellWatchdog { try $0.stop([.oneshot]) }
            await waitForExit(of: [process], timeout: .seconds(5))
            return nil
        }

        tellWatchdog { try $0.remove(.oneshot) }
        return process.terminationStatus
    }

    // MARK: - Waiting

    private func requireRunning(_ slot: EngineSlot) throws {
        guard children[slot]?.process.isRunning == true else {
            throw EngineStartupFailure.exited(slot, status: lastExitStatus[slot], duringStartup: true)
        }
    }

    // These waits count only time the Mac is awake, so closing the lid can't use them up and report a
    // healthy process as hung.

    private func waitUntilReady(
        _ slot: EngineSlot,
        timeout: Duration,
        timedOut: EngineStartupFailure,
        isReady: () async -> Bool
    ) async throws {
        let clock = SuspendingClock()
        let deadline = clock.now + timeout
        while clock.now < deadline {
            if await isReady() { return }
            try requireRunning(slot)
            try? await Task.sleep(for: .milliseconds(250))
        }
        throw timedOut
    }

    private func waitForExit(of processes: [Process], timeout: Duration) async {
        let clock = SuspendingClock()
        let deadline = clock.now + timeout
        while processes.contains(where: \.isRunning), clock.now < deadline {
            try? await Task.sleep(for: .milliseconds(200))
        }
    }

    private func waitUntilGone(_ identities: [ProcessIdentity], timeout: Duration) async -> Bool {
        let clock = SuspendingClock()
        let deadline = clock.now + timeout
        while true {
            let isAnyAlive = identities.contains { ProcessInspector.observe(pid: $0.pid) == .live($0) }
            guard isAnyAlive else { return true }
            guard clock.now < deadline else { return false }
            try? await Task.sleep(for: .milliseconds(200))
        }
    }

    // MARK: - Exits

    private func handleExit(of slot: EngineSlot, generation: Int, status: Int32) {
        guard children[slot]?.generation == generation else { return }

        children[slot] = nil
        lastExitStatus[slot] = status
        writeRunRecord()
        report(.componentsChanged)

        // A start in progress checks every process before it reports running, and a stop expects this.
        guard phase == .running else { return }

        switch slot {
        case .postgres, .redis:
            report(.coreServiceExited(slot, status: status))
        case .api:
            scheduleRestart(of: slot)
        case .workerProcessing, .workerScraper:
            if workersWanted {
                scheduleRestart(of: slot)
            }
        case .oneshot, .leftover:
            break
        }
    }

    /// Stopping the exited slot sweeps its generation's tag, so a crashed scraper's Chromium goes
    /// with it and the next generation starts clean.
    private func scheduleRestart(of slot: EngineSlot) {
        tellWatchdog { try $0.stop([slot]) }

        let now = Date.now
        let recent = restartHistory[slot, default: []].filter { now.timeIntervalSince($0) < Self.restartWindow }
        guard recent.count < Self.restartDelays.count else {
            restartHistory[slot] = recent
            report(.degraded(
                "\(slot.displayName) keeps exiting, so ImmoRadar stopped restarting it. Restart the engine to try again. Check ~/Library/Logs/ImmoRadar/\(slot.logFileName)."
            ))
            return
        }

        restartHistory[slot] = recent + [now]
        let delay = Self.restartDelays[recent.count]
        restartTasks[slot]?.cancel()
        restartTasks[slot] = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.restart(slot)
        }
    }

    private func restart(_ slot: EngineSlot) {
        restartTasks[slot] = nil
        guard phase == .running, children[slot] == nil, let layout else { return }
        guard !slot.isWorker || workersWanted else { return }

        let entry: URL
        switch slot {
        case .api: entry = layout.apiEntry
        case .workerProcessing: entry = layout.processingEntry
        case .workerScraper: entry = layout.scraperEntry
        case .oneshot, .redis, .postgres, .leftover: return
        }

        do {
            try spawnNode(slot, entry: entry, layout: layout)
        } catch {
            scheduleRestart(of: slot)
        }
    }

    // MARK: - Health

    private func startHealthLoop(_ layout: EngineLayout) {
        healthTask?.cancel()
        let baseURL = layout.apiBaseURL
        let logsDirectory = layout.logsDirectory

        healthTask = Task { [weak self] in
            var failures = 0
            var checks = 0
            var countedGeneration: Int?
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.healthInterval)
                guard !Task.isCancelled else { return }

                checks += 1
                if checks.isMultiple(of: Self.healthChecksPerRotation) {
                    await self?.rotateLogs(in: logsDirectory, largerThan: EngineLogs.rotationLimitWhileRunning)
                }

                let probedGeneration = self?.children[.api]?.generation
                let isHealthy = await Self.isAPIHealthy(baseURL: baseURL)
                guard !Task.isCancelled, let self else { return }
                // A probe says nothing about an API that started after it began, and failures never
                // carry over from one API process to the next.
                guard self.phase == .running, let probedGeneration,
                      self.children[.api]?.generation == probedGeneration else {
                    failures = 0
                    continue
                }
                if probedGeneration != countedGeneration {
                    countedGeneration = probedGeneration
                    failures = 0
                }

                failures = isHealthy ? 0 : failures + 1
                if failures >= Self.healthFailureLimit {
                    failures = 0
                    Log.engine.error("The local API stopped answering, so it is being restarted")
                    self.tellWatchdog { try $0.stop([.api]) }
                }
            }
        }
    }

    // MARK: - Probes

    private static func isAPIHealthy(baseURL: URL) async -> Bool {
        guard let healthURL = URL(string: "/health", relativeTo: baseURL)?.absoluteURL else { return false }

        var request = URLRequest(url: healthURL)
        request.timeoutInterval = 2
        request.cachePolicy = .reloadIgnoringLocalCacheData

        guard let (_, response) = try? await URLSession.shared.data(for: request),
              let httpResponse = response as? HTTPURLResponse else {
            return false
        }
        return (200..<300).contains(httpResponse.statusCode)
    }

    private static func isPostgresReady(_ layout: EngineLayout) async -> Bool {
        let port = layout.ports.postgres
        let pgIsReady = layout.postgresBinDirectory.appendingPathComponent("pg_isready")
        guard FileManager.default.isExecutableFile(atPath: pgIsReady.path) else {
            return await isTCPPortOpen(host: "127.0.0.1", port: port)
        }

        return await exitsCleanly(
            executable: pgIsReady,
            arguments: ["-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-U", "postgres", "-t", "1"]
        )
    }

    private static func isTCPPortOpen(host: String, port: Int) async -> Bool {
        await exitsCleanly(executable: URL(fileURLWithPath: "/usr/bin/nc"), arguments: ["-z", host, String(port)])
    }

    private static func exitsCleanly(executable: URL, arguments: [String]) async -> Bool {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = executable
            process.arguments = arguments
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            process.terminationHandler = { terminated in
                continuation.resume(returning: terminated.terminationStatus == 0)
            }

            do {
                try process.run()
            } catch {
                continuation.resume(returning: false)
            }
        }
    }

    private func report(_ event: Event) {
        onEvent?(event)
    }
}
