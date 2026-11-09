import Foundation

enum LocalRuntimeAuth {
    static let keychainKey = "localRuntimeApiToken"
    static let keychainService = "com.immoradar.local-runtime"
    private enum AuthError: Error { case isolatedSmokeBlocked }
    private static var smokeRequested: Bool { ProcessInfo.processInfo.environment["IMMORADAR_SMOKE_TEST"] != nil }
    private static var permitsStoredCredentials: Bool { AppLaunchMode.current == .production && !smokeRequested }

    private static var environmentOverrideToken: String? {
        guard let raw = ProcessInfo.processInfo.environment["IMMORADAR_LOCAL_RUNTIME_API_TOKEN"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !raw.isEmpty else {
            return nil
        }

        return raw
    }

    private static let store = KeychainStore(service: keychainService)

    static func loadToken(allowUserInteraction: Bool = true) -> String? {
        if let environmentOverrideToken {
            return environmentOverrideToken
        }
        guard permitsStoredCredentials else { return nil }

        guard let token = readToken(in: store, allowUserInteraction: allowUserInteraction).value,
              !token.isEmpty else {
            return nil
        }
        return token
    }

    static func ensureToken() throws -> String {
        if let environmentOverrideToken {
            return environmentOverrideToken
        }
        guard permitsStoredCredentials else { throw AuthError.isolatedSmokeBlocked }

        return try ensureToken(in: store)
    }

    /// Reuses the stored token, or stores a new one when there is none. A failed read throws
    /// instead of writing, so a token that is there but can't be read right now is never replaced.
    static func ensureToken(in store: some SecretStore) throws -> String {
        switch readToken(in: store, allowUserInteraction: true) {
        case .found(let token) where !token.isEmpty:
            return token
        case .found, .notFound:
            let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max) }
            let token = bytes.map { String(format: "%02x", $0) }.joined()
            try store.write(key: keychainKey, value: token)
            return token
        case .failed(let status):
            throw KeychainError.readFailed(status: status)
        }
    }

    static func resetToken() {
        guard permitsStoredCredentials else { return }
        guard environmentOverrideToken == nil else { return }
        store.delete(key: keychainKey)
    }

    private static func readToken(in store: some SecretStore, allowUserInteraction: Bool) -> KeychainReadResult {
        let result = store.read(key: keychainKey, allowUserInteraction: allowUserInteraction)
        guard case .found(let token) = result else { return result }
        return .found(token.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    static func preferredToken(
        for apiBaseURL: String,
        userToken: String?,
        allowUserInteraction: Bool = true
    ) -> String? {
        guard permitsStoredCredentials else { return nil }
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

/// What the UI sees of the engine. `EngineSupervisor` runs the processes, and this turns its events
/// into state, progress and the startup diagnostics file.
@MainActor @Observable
final class LocalRuntimeService {
    enum State: Equatable {
        case stopped
        case starting
        case running
        case degraded(String)
        case stopping
        case unavailable(String)
        case failed(String)

        var failureMessage: String? {
            switch self {
            case .unavailable(let message), .failed(let message), .degraded(let message):
                return message
            case .stopped, .starting, .running, .stopping:
                return nil
            }
        }

        var isDegraded: Bool {
            if case .degraded = self { return true }
            return false
        }

        var title: String {
            switch self {
            case .stopped:
                return "Background engine stopped"
            case .starting:
                return "Starting background engine…"
            case .running:
                return "Background engine running"
            case .degraded:
                return "Background engine partly running"
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
            case .unavailable(let message), .failed(let message), .degraded(let message):
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
        enum Kind: String, CaseIterable {
            case postgres = "Postgres"
            case redis = "Redis"
            case api = "API"
            case processing = "Processing"
            case scraper = "Scraper"

            fileprivate var slot: EngineSlot {
                switch self {
                case .postgres: return .postgres
                case .redis: return .redis
                case .api: return .api
                case .processing: return .workerProcessing
                case .scraper: return .workerScraper
                }
            }
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

    private enum ResetError: LocalizedError {
        case notAllowed
        case busy
        case processesRunning(Int)

        var errorDescription: String? {
            switch self {
            case .notAllowed:
                return "This launch can’t change the local engine."
            case .busy:
                return "Couldn’t reset the local engine while it’s starting or stopping. Try again in a moment."
            case .processesRunning(let count):
                return "Couldn’t reset the local engine because \(count) of its processes kept running."
            }
        }
    }

    private static let maxStartupRetryCount = 2
    private static let coreRestartDelays: [Duration] = [.seconds(1), .seconds(5), .seconds(30)]
    private static let coreRestartWindow: TimeInterval = 300

    var state: State = .stopped
    var progressStatus: ProgressStatus?
    var componentStatuses: [ComponentStatus] = ComponentStatus.Kind.allCases.map {
        ComponentStatus(kind: $0, isRunning: false, pid: nil)
    }
    var activeBootMode: BootMode?
    var runtimeDescription: String?
    var runtimeVersion: String?

    private var supervisor: EngineSupervisor?
    private var activeAPIBaseURL: String?
    private var coreRestartTimes: [Date] = []
    private var coreRestartTask: Task<Void, Never>?
    private var startTask: Task<Void, Never>?
    private var startMovesOnlyWorkers = false
    private var workerHolds = WorkerHolds()
    private var workerHoldObserver: WorkerHoldObserver?
    private var workerHoldWaitTask: Task<Void, Never>?
    private var lastStartupFailure: EngineStartupFailure?
    private var activeStartupAttemptID: Int?
    private var nextStartupAttemptID = 0
    private var activeStartupRetryCount = 0
    private var activeStartupStep: EngineStartupStep?
    private var activeStartupStartedAt: Date?
    private let allowsEngineEffects: Bool
    private let isSmokeRun: Bool

    init(smokeContext: IsolatedSmokeContext? = nil, launchMode: AppLaunchMode = .current) {
        isSmokeRun = smokeContext != nil
        // A test that asks for a production launch still runs inside a test process.
        let mode = AppLaunchMode.current == .production ? launchMode : AppLaunchMode.current
        allowsEngineEffects = AppLaunchPolicy(mode: mode, smokeContext: smokeContext).allowsEngineEffects
    }

    var isBusy: Bool {
        switch state {
        case .starting, .stopping:
            return true
        case .stopped, .running, .degraded, .unavailable, .failed:
            return false
        }
    }

    var isEngineRunning: Bool {
        supervisor?.isRunning == true
    }

    /// Why the workers are stopped although monitoring is on, if they are.
    var workerHoldExplanation: String? {
        workerHolds.explanation
    }

    private var workersShouldRun: Bool {
        activeBootMode == .active && !workerHolds.isHolding
    }

    static var runtimeHomeURL: URL { EngineLayout.runtimeHomeURL() }

    static var logsDirectoryURL: URL { EngineLayout.logsDirectoryURL() }

    static var startupDiagnosticsURL: URL {
        logsDirectoryURL.appendingPathComponent("startup-diagnostics.json", isDirectory: false)
    }

    // MARK: - Status

    func refreshStatus(apiBaseURL: String) async {
        guard allowsEngineEffects, isIdle else { return }

        do {
            let layout = try await EngineLayout.resolve(apiBaseURL: apiBaseURL)
            guard isIdle else { return }
            applyRuntimeMetadata(layout)
            if case .unavailable = state {
                lastStartupFailure = nil
                state = .stopped
                persistStartupDiagnostics()
            }
        } catch {
            guard isIdle else { return }
            let failure = startupFailure(from: error)
            guard state != .unavailable(failure.message) else { return }
            lastStartupFailure = failure
            state = .unavailable(failure.message)
            progressStatus = nil
            persistStartupDiagnostics()
        }
    }

    /// Reads only what `applyRuntimeMetadata` cached, because views call this from their bodies.
    func diagnosticsSummary() -> DiagnosticsSummary {
        DiagnosticsSummary(
            runtimeDescription: runtimeDescription ?? "Local engine",
            runtimeVersion: runtimeVersion,
            storagePath: Self.runtimeHomeURL.path,
            logsPath: Self.logsDirectoryURL.path,
            startupDiagnosticsPath: Self.startupDiagnosticsURL.path,
            lastErrorMessage: state.failureMessage,
            lastFailureCode: lastStartupFailure?.code.rawValue
        )
    }

    private var isIdle: Bool {
        !isBusy && supervisor?.isActive != true
    }

    // MARK: - Starting

    func start(
        apiBaseURL: String,
        bootMode: BootMode = .active,
        policy: StartPolicy = .ifNeeded
    ) async {
        guard allowsEngineEffects else {
            state = .unavailable("This launch can’t run the local engine.")
            return
        }
        observeWorkerHoldsIfNeeded()

        // The start in progress launches workers from this choice, or applies it when it finishes.
        // Waiting for it means the caller sees how that start ended, not its progress.
        while let startTask {
            let keepsEngine = startMovesOnlyWorkers
            activeBootMode = bootMode
            await supervisor?.setWorkersRunning(workersShouldRun)
            await startTask.value
            // A restart still has work to do after a start that left the engine in place.
            guard policy == .forceRestart, keepsEngine else { return }
        }

        // Only a reset is busy with no start running, and the next start reads this choice.
        guard !isBusy else {
            activeBootMode = bootMode
            return
        }

        // A core service is down and its restart is waiting out a delay, so this start replaces it.
        let replacesPendingRestart = coreRestartTask != nil
        cancelCoreRestart()
        coreRestartTimes.removeAll()

        await runStart(
            apiBaseURL: apiBaseURL,
            bootMode: bootMode,
            policy: replacesPendingRestart ? .forceRestart : policy
        )
    }

    /// Owns the one start that can run at a time, so a restart timer or a second click can't run
    /// alongside it. It's a task of its own so a caller that goes away can't abandon a half-started
    /// engine.
    private func runStart(apiBaseURL: String, bootMode: BootMode, policy: StartPolicy) async {
        // Written before the task exists, because a click already queued runs before the task's body
        // and its newer choice has to survive.
        activeBootMode = bootMode
        // Only the workers depend on the mode, so an engine that is up stays up and the API keeps answering.
        let movesOnlyWorkers = policy == .ifNeeded && isEngineRunning
        startMovesOnlyWorkers = movesOnlyWorkers

        let task = Task { [weak self] in
            guard let self else { return }
            if movesOnlyWorkers {
                await self.applyWorkerState()
            } else {
                await self.performStart(apiBaseURL: apiBaseURL)
            }
            self.startTask = nil

            // Exits are ignored while a start runs, because it replaces the engine. One that is still
            // down came after the new engine was up, or during a start that only moved the workers.
            if let down = self.supervisor?.downCoreService {
                self.handleCoreServiceExit(down.slot, status: down.status)
            }
        }
        startTask = task
        await task.value
    }

    private func performStart(apiBaseURL: String) async {
        beginStartupAttempt()
        activeAPIBaseURL = apiBaseURL
        state = .starting

        do {
            let layout = try await EngineLayout.resolve(apiBaseURL: apiBaseURL)
            applyRuntimeMetadata(layout)
            let token = try LocalRuntimeAuth.ensureToken()
            let supervisor = engineSupervisor()

            if supervisor.isActive {
                state = .stopping
                await supervisor.stop()
            }
            try await startWithRetries(supervisor, layout: layout, token: token)

            lastStartupFailure = nil
            state = .running
            progressStatus = nil
            finishStartupAttempt()
        } catch {
            await supervisor?.stop()
            recordStartFailure(startupFailure(from: error))
        }
    }

    // MARK: - Workers

    private func applyWorkerState() async {
        guard let supervisor else { return }

        await supervisor.setWorkersRunning(workersShouldRun)
        if state.isDegraded, supervisor.hasEveryWantedProcess {
            lastStartupFailure = nil
            state = .running
        }
        persistStartupDiagnostics()
    }

    /// A smoke run proves the engine's lifecycle, which shouldn't depend on how warm the Mac is.
    private func observeWorkerHoldsIfNeeded() {
        guard workerHoldObserver == nil, !isSmokeRun else { return }

        let observer = WorkerHoldObserver { [weak self] reason, isActive in
            self?.noteWorkerHold(reason, isActive: isActive)
        }
        workerHoldObserver = observer
        for reason in observer.currentReasons {
            workerHolds.set(reason, isActive: true, now: .now)
        }
    }

    func noteWorkerHold(_ reason: WorkerHolds.Reason, isActive: Bool) {
        Log.engine.info("Worker hold \(String(describing: reason), privacy: .public): \(isActive, privacy: .public)")
        workerHolds.set(reason, isActive: isActive, now: .now)
        workerHoldsChanged()
    }

    private func workerHoldsChanged() {
        scheduleWorkerHoldWaitEnd()
        Task { await applyWorkerState() }
    }

    /// With a hold still active there is nothing to wait for, because clearing it arms this again.
    private func scheduleWorkerHoldWaitEnd() {
        workerHoldWaitTask?.cancel()
        workerHoldWaitTask = nil
        guard workerHolds.active.isEmpty, let resumesAt = workerHolds.resumesAt else { return }

        workerHoldWaitTask = Task { [weak self] in
            try? await Task.sleep(until: resumesAt, clock: .continuous)
            guard !Task.isCancelled, let self else { return }
            self.workerHolds.finishWait(now: .now)
            self.workerHoldsChanged()
        }
    }

    // MARK: - Engine start

    private func startWithRetries(
        _ supervisor: EngineSupervisor,
        layout: EngineLayout,
        token: String
    ) async throws {
        while true {
            let isRetry = activeStartupRetryCount > 0
            state = .starting
            recordStartupStep(.preparingStorage)
            setProgress(
                title: isRetry ? "Retrying local engine" : "Preparing local engine",
                detail: isRetry
                    ? "ImmoRadar is retrying the local engine after a transient startup issue."
                    : "Setting up local storage and validating the bundled runtime.",
                fractionCompleted: 0.08
            )

            do {
                try await supervisor.start(layout: layout, token: token, monitoring: workersShouldRun)
                return
            } catch {
                await supervisor.stop()

                let failure = startupFailure(from: error)
                guard failure.isTransient, activeStartupRetryCount < Self.maxStartupRetryCount else {
                    throw failure
                }

                activeStartupRetryCount += 1
                lastStartupFailure = failure
                state = .starting
                recordStartupStep(failure.step)
                setProgress(
                    title: "Retrying local engine",
                    detail: "A transient startup issue was detected. ImmoRadar is retrying automatically.",
                    fractionCompleted: 0.08
                )
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private func engineSupervisor() -> EngineSupervisor {
        // The supervisor is the only code that signals engine processes.
        precondition(allowsEngineEffects, "This launch can't run the local engine.")
        if let supervisor { return supervisor }

        let supervisor = EngineSupervisor()
        supervisor.onEvent = { [weak self] event in
            self?.handle(event)
        }
        self.supervisor = supervisor
        return supervisor
    }

    private func startupFailure(from error: any Error) -> EngineStartupFailure {
        switch error {
        case let failure as EngineStartupFailure:
            return failure
        case let layoutError as EngineLayout.LayoutError:
            return EngineStartupFailure(layoutError: layoutError)
        default:
            return .unexpected(error.localizedDescription)
        }
    }

    private func recordStartFailure(_ failure: EngineStartupFailure) {
        lastStartupFailure = failure
        activeStartupStep = failure.step ?? activeStartupStep
        progressStatus = nil
        switch failure.code {
        case .invalidBaseURL, .nonLocalBaseURL:
            state = .unavailable(failure.message)
        default:
            state = .failed(failure.message)
        }
        finishStartupAttempt()
    }

    // MARK: - Engine events

    private func handle(_ event: EngineSupervisor.Event) {
        switch event {
        case .progress(let title, let detail, let fraction):
            setProgress(title: title, detail: detail, fractionCompleted: fraction)
        case .step(let step):
            recordStartupStep(step)
        case .componentsChanged:
            refreshComponentStatuses()
            persistStartupDiagnostics()
        case .degraded(let message):
            lastStartupFailure = EngineStartupFailure(code: .componentExitedUnexpectedly, message: message)
            state = .degraded(message)
            persistStartupDiagnostics()
        case .failed(let failure):
            cancelCoreRestart()
            lastStartupFailure = failure
            state = .failed(failure.message)
            progressStatus = nil
            persistStartupDiagnostics()
        case .coreServiceExited(let slot, let status):
            handleCoreServiceExit(slot, status: status)
        }
    }

    /// Everything depends on Postgres and Redis, so losing either restarts the whole engine.
    private func handleCoreServiceExit(_ slot: EngineSlot, status: Int32) {
        // A restart already on its way covers this exit too, and so does a start that is running.
        guard coreRestartTask == nil, startTask == nil else { return }

        let failure = EngineStartupFailure.exited(slot, status: status, duringStartup: false)
        lastStartupFailure = failure

        let now = Date.now
        let recent = coreRestartTimes.filter { now.timeIntervalSince($0) < Self.coreRestartWindow }
        coreRestartTimes = recent

        guard recent.count < Self.coreRestartDelays.count,
              let apiBaseURL = activeAPIBaseURL,
              let bootMode = activeBootMode else {
            state = .failed(failure.message)
            progressStatus = nil
            persistStartupDiagnostics()
            Task { [weak self] in
                await self?.supervisor?.stop()
            }
            return
        }

        coreRestartTimes.append(now)
        state = .degraded("\(slot.displayName) exited, so ImmoRadar is restarting the engine.")
        persistStartupDiagnostics()

        let delay = Self.coreRestartDelays[recent.count]
        coreRestartTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            self.coreRestartTask = nil
            await self.runStart(apiBaseURL: apiBaseURL, bootMode: bootMode, policy: .forceRestart)
        }
    }

    private func cancelCoreRestart() {
        coreRestartTask?.cancel()
        coreRestartTask = nil
    }

    // MARK: - Reset

    func resetLocalEngine(apiBaseURL: String) async throws {
        guard allowsEngineEffects else { throw ResetError.notAllowed }

        // Cutting a start off halfway would leave its processes behind, so the reset goes after it.
        while let startTask {
            await startTask.value
        }
        guard !isBusy else { throw ResetError.busy }

        cancelCoreRestart()
        coreRestartTimes.removeAll()
        progressStatus = nil
        activeStartupAttemptID = nil
        activeStartupStep = nil
        state = .stopping

        do {
            let supervisor = engineSupervisor()
            await supervisor.stop()
            try await stopLeftovers(using: supervisor, apiBaseURL: apiBaseURL)

            // Deleting the database folder can take seconds, so it runs off the main actor.
            let runtimeHome = Self.runtimeHomeURL
            try await Self.offMainActor {
                let fileManager = FileManager.default
                if fileManager.fileExists(atPath: runtimeHome.path) {
                    try fileManager.removeItem(at: runtimeHome)
                }
            }
        } catch {
            lastStartupFailure = startupFailure(from: error)
            state = .failed(error.localizedDescription)
            persistStartupDiagnostics()
            throw error
        }

        LocalRuntimeAuth.resetToken()
        activeBootMode = nil
        lastStartupFailure = nil
        state = .stopped
        refreshComponentStatuses()
        persistStartupDiagnostics()
    }

    private func stopLeftovers(using supervisor: EngineSupervisor, apiBaseURL: String) async throws {
        do {
            let layout = try await EngineLayout.resolve(apiBaseURL: apiBaseURL)
            try await supervisor.stopLeftoversOnly(layout: layout)
        } catch is EngineLayout.LayoutError {
            // With no layout there is no watchdog script to stop anything with, so only look.
            let home = Self.runtimeHomeURL
            let leftovers = await Self.offMainActor {
                EngineLeftovers.find(runtimeHome: home, recorded: [])
            }
            guard leftovers.isEmpty else { throw ResetError.processesRunning(leftovers.count) }
        }
    }

    /// Runs blocking file and process work on the shared pool instead of the main actor. The
    /// caller waits for it, so it ends with the reset and needs no cancelling of its own.
    @concurrent
    private nonisolated static func offMainActor<T: Sendable>(
        _ work: @Sendable () throws -> T
    ) async rethrows -> T {
        try work()
    }

    // MARK: - Progress and diagnostics

    private func setProgress(title: String, detail: String, fractionCompleted: Double?) {
        progressStatus = ProgressStatus(title: title, detail: detail, fractionCompleted: fractionCompleted)
    }

    private func applyRuntimeMetadata(_ layout: EngineLayout) {
        runtimeDescription = layout.runtimeDescription
        runtimeVersion = layout.runtimeVersion
    }

    private func refreshComponentStatuses() {
        let running = supervisor?.runningPIDs ?? [:]
        componentStatuses = ComponentStatus.Kind.allCases.map { kind in
            let pid = running[kind.slot]
            return ComponentStatus(kind: kind, isRunning: pid != nil, pid: pid)
        }
    }

    private func beginStartupAttempt() {
        nextStartupAttemptID += 1
        activeStartupAttemptID = nextStartupAttemptID
        activeStartupRetryCount = 0
        activeStartupStep = nil
        activeStartupStartedAt = Date.now
        lastStartupFailure = nil
    }

    private func finishStartupAttempt() {
        persistStartupDiagnostics()
        activeStartupAttemptID = nil
        activeStartupStep = nil
        activeStartupStartedAt = nil
    }

    private func recordStartupStep(_ step: EngineStartupStep?) {
        activeStartupStep = step
        persistStartupDiagnostics()
    }

    private var diagnosticsStatus: String {
        switch state {
        case .stopped: return "stopped"
        case .starting: return activeStartupRetryCount > 0 ? "retrying" : "starting"
        case .running: return "running"
        case .degraded: return "degraded"
        case .stopping: return "stopping"
        case .unavailable, .failed: return "failed"
        }
    }

    /// Best effort: diagnostics must never block starting or stopping.
    private func persistStartupDiagnostics() {
        let payload = StartupDiagnosticsPayload(
            attemptID: activeStartupAttemptID,
            bootMode: activeBootMode?.rawValue,
            runtimeDescription: runtimeDescription ?? "Local engine",
            runtimeVersion: runtimeVersion,
            storagePath: Self.runtimeHomeURL.path,
            logsPath: Self.logsDirectoryURL.path,
            status: diagnosticsStatus,
            step: activeStartupStep?.rawValue,
            retryCount: activeStartupRetryCount,
            maxRetryCount: Self.maxStartupRetryCount,
            failureCode: lastStartupFailure?.code.rawValue,
            failureMessage: lastStartupFailure?.message,
            logFileName: lastStartupFailure?.logFileName,
            startedAt: activeStartupStartedAt,
            updatedAt: Date.now,
            components: componentStatuses.map {
                StartupDiagnosticsComponentSnapshot(component: $0.kind.rawValue, isRunning: $0.isRunning, pid: $0.pid)
            }
        )

        do {
            try FileManager.default.createDirectory(at: Self.logsDirectoryURL, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(payload).write(to: Self.startupDiagnosticsURL, options: .atomic)
        } catch {
            Log.engine.error("Couldn't write startup diagnostics: \(error.localizedDescription, privacy: .public)")
        }
    }
}
