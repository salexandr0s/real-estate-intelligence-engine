import Foundation

enum EngineStartupStep: String, Codable, Sendable {
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

struct EngineStartupFailure: Error, LocalizedError, Equatable, Sendable {
    enum Code: String, Codable, Sendable {
        case smokeBoundaryUnavailable
        case invalidBaseURL
        case nonLocalBaseURL
        case runtimeArtifactsMissing
        case manifestMissing
        case nodeExecutableMissing
        case serviceBinaryMissing
        case repoBootstrapToolMissing
        case repoBootstrapDependenciesMissing
        case repoBootstrapFailed
        case watchdogUnavailable
        case leftoverProcessesRunning
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
    var step: EngineStartupStep?
    var logFileName: String?
    var slot: EngineSlot?
    var exitCode: Int32?
    var isTransient = false

    var errorDescription: String? { message }

    init(layoutError: EngineLayout.LayoutError) {
        let code: Code = switch layoutError {
        case .invalidBaseURL: .invalidBaseURL
        case .nonLocalBaseURL: .nonLocalBaseURL
        case .runtimeArtifactsMissing: .runtimeArtifactsMissing
        case .manifestMissing: .manifestMissing
        case .nodeExecutableMissing: .nodeExecutableMissing
        case .serviceMissing: .serviceBinaryMissing
        }
        self.init(code: code, message: layoutError.errorDescription ?? "The local engine isn’t available.")
    }

    init(
        code: Code,
        message: String,
        step: EngineStartupStep? = nil,
        logFileName: String? = nil,
        slot: EngineSlot? = nil,
        exitCode: Int32? = nil,
        isTransient: Bool = false
    ) {
        self.code = code
        self.message = message
        self.step = step
        self.logFileName = logFileName
        self.slot = slot
        self.exitCode = exitCode
        self.isTransient = isTransient
    }

    static func unexpected(_ message: String) -> EngineStartupFailure {
        EngineStartupFailure(code: .componentExitedUnexpectedly, message: message, step: .verifyingServices)
    }

    static func launchFailed(_ slot: EngineSlot, logFileName: String) -> EngineStartupFailure {
        EngineStartupFailure(
            code: .componentExitedUnexpectedly,
            message: "Couldn’t launch \(slot.displayName). Check ~/Library/Logs/ImmoRadar/\(logFileName).",
            step: slot.startingStep,
            logFileName: logFileName,
            slot: slot,
            isTransient: slot == .redis || slot == .api
        )
    }

    /// Postgres is left out of retries: with leftovers gone and the pid file checked, its exit
    /// during startup points at the data directory, and a retry would hit the same thing.
    static func exited(_ slot: EngineSlot, status: Int32?, duringStartup: Bool) -> EngineStartupFailure {
        let log = "Check ~/Library/Logs/ImmoRadar/\(slot.logFileName)."
        let code: Code
        let message: String
        let step: EngineStartupStep?

        switch (slot, duringStartup) {
        case (.postgres, true):
            code = .postgresExitedBeforeReady
            message = "Postgres exited before it became ready. \(log)"
            step = .waitingForPostgres
        case (.redis, true):
            code = .redisExitedBeforeReady
            message = "Redis exited before it became ready. \(log)"
            step = .waitingForRedis
        case (.api, true):
            code = .apiExitedBeforeHealthy
            message = "The local API exited before it became healthy. \(log)"
            step = .waitingForAPI
        default:
            code = .componentExitedUnexpectedly
            message = "\(slot.displayName) exited unexpectedly. \(log)"
            step = slot.startingStep
        }

        return EngineStartupFailure(
            code: code,
            message: message,
            step: step,
            logFileName: slot.logFileName,
            slot: slot,
            exitCode: status,
            isTransient: duringStartup && (slot == .redis || slot == .api)
        )
    }
}
