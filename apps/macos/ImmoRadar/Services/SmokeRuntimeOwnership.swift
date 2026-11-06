import Foundation

/// Pure decisions for one isolated smoke session. This type performs no process,
/// filesystem, credential or network operations. Observations must come from a
/// fresh, fail-closed adapter; values constructed here do not authenticate an
/// artifact receipt or establish that a native Process was launched by us.
struct SmokeRuntimeOwnership {
    enum Refusal: String, Error {
        case invalidSession, missingInventory, artifactDrift, invalidDataPath
        case externalEnrollment, invalidEnrollment, identityUnverified, identityChanged
        case childrenStillLive, apiNotOwned
    }

    struct Creation: Equatable, Comparable {
        let seconds: UInt64
        let microseconds: UInt64

        var isValid: Bool { seconds > 0 && microseconds < 1_000_000 }

        static func < (lhs: Self, rhs: Self) -> Bool {
            lhs.seconds == rhs.seconds
                ? lhs.microseconds < rhs.microseconds : lhs.seconds < rhs.seconds
        }
    }

    struct Command: Equatable {
        let executable: String
        /// Complete, bounded argv, including argv[0]. Post-exec title forms must
        /// be enumerated explicitly by the trusted launch recipe, never a prefix.
        let arguments: [String]

        var isValid: Bool {
            SmokeRuntimeOwnership.isCanonicalAbsolute(executable)
                && !arguments.isEmpty
                && arguments.allSatisfy { !$0.contains("\0") }
                && arguments.reduce(executable.utf8.count) { $0 + $1.utf8.count + 1 } <= 65_536
        }
    }

    struct Identity: Equatable {
        let pid: Int32
        let parentPID: Int32
        let groupID: Int32
        let realUserID: UInt32
        let effectiveUserID: UInt32
        let creation: Creation
        let command: Command

        var isValid: Bool { pid > 0 && parentPID > 0 && groupID > 0 && creation.isValid && command.isValid }
    }

    enum Observation: Equatable {
        case live(Identity)
        /// Only ESRCH or a complete, validated zombie record proves exit.
        case exited(pid: Int32)
        case unknown
    }

    enum ReadError { case none, noSuchProcess, permissionDenied, ioFailure, other }

    /// Classify an injected kernel-read result. Zero without ESRCH and every
    /// short/error/malformed payload remain unknown, never evidence of exit.
    static func observation(
        byteCount: Int, expectedByteCount: Int, error: ReadError,
        requestedPID: Int32, reportedPID: Int32, kernelStatus: Int,
        identity: Identity?
    ) -> Observation {
        guard requestedPID > 0 else { return .unknown }
        if byteCount == 0, error == .noSuchProcess { return .exited(pid: requestedPID) }
        guard expectedByteCount > 0, byteCount == expectedByteCount, error == .none,
              reportedPID == requestedPID, (1...5).contains(kernelStatus),
              let identity, identity.pid == requestedPID, identity.isValid else { return .unknown }
        return kernelStatus == 5 ? .exited(pid: requestedPID) : .live(identity)
    }

    struct Configuration: Equatable {
        let taskRoot: String
        let bundleRoot: String
        let runtimeHome: String
        let logsDirectory: String
        let apiURL: String
        let owner: UInt32
    }

    enum ArtifactKind: Equatable {
        case directory
        case file(sha256: String)
        case symlink(target: String)
    }

    struct Artifact: Equatable {
        let kind: ArtifactKind
        let owner: UInt32
        let canonicalPath: String
    }

    /// These are comparison inputs, not native authorization capabilities. The
    /// future native caller must obtain expected bytes from the independently
    /// reviewed, caller-pinned receipt; never from the candidate being checked.
    struct Inventory: Equatable {
        let taskRoot: DataPath
        let taskRootPermissions: UInt16
        let root: String
        let canonicalRoot: String
        let owner: UInt32
        let rootKind: DataKind
        let entries: [String: Artifact]
    }

    enum DataKind: Equatable { case directory, regularFile, missing, symlink, other }

    struct DataPath: Equatable {
        let path: String
        let canonicalPath: String
        let owner: UInt32
        let kind: DataKind
    }

    enum Origin { case serviceRun, discovered, registry, portOrHealth, externalHandle }
    enum SignalDecision: Equatable { case signal(Int32), gone, refused(Refusal) }
    enum LifecycleState: Equatable { case starting, running, stopping, stopped, failed }

    struct Enrollment {
        let token: UUID
        let handleID: UUID
        let attempt: Int
        let purpose: String
        let initial: Identity
        let commands: [Command]
        fileprivate(set) var commandIndex: Int
        fileprivate(set) var verifiedExited: Bool
    }

    let configuration: Configuration
    let appIdentity: Identity
    private let expectedInventory: Inventory?
    private let requiredArtifacts: Set<String>
    private(set) var refusal: Refusal?
    private(set) var enrollments: [UUID: Enrollment] = [:]

    init(configuration: Configuration, appIdentity: Identity, expectedInventory: Inventory?, requiredArtifacts: Set<String>) {
        self.configuration = configuration
        self.appIdentity = appIdentity
        self.expectedInventory = expectedInventory
        self.requiredArtifacts = requiredArtifacts
        let roots = [configuration.taskRoot, configuration.bundleRoot, configuration.runtimeHome, configuration.logsDirectory]
        if !appIdentity.isValid || appIdentity.groupID != appIdentity.pid
            || appIdentity.realUserID != configuration.owner || appIdentity.effectiveUserID != configuration.owner
            || !roots.allSatisfy(Self.isCanonicalAbsolute)
            || !roots.dropFirst().allSatisfy({ Self.isInside($0, root: configuration.taskRoot) })
            || Set(roots).count != roots.count
            || configuration.taskRoot.split(separator: "/").last?.hasPrefix("immoradar-smoke.") != true
            || configuration.bundleRoot != configuration.taskRoot + "/install/ImmoRadar.app"
            || configuration.runtimeHome != configuration.taskRoot + "/runtime-home"
            || configuration.logsDirectory != configuration.taskRoot + "/logs"
            || appIdentity.command.executable != configuration.bundleRoot + "/Contents/MacOS/ImmoRadar"
            || !Self.isLoopbackAPI(configuration.apiURL) {
            refusal = .invalidSession
        }
    }

    @discardableResult
    mutating func refuse(_ reason: Refusal) -> Bool {
        if refusal == nil { refusal = reason }
        return false
    }

    /// Revalidate all immutable artifacts and the app session before each
    /// effect. A previous success is not a cached capability for a later call.
    mutating func validateBoundary(app: Observation, inventory: Inventory?) -> Bool {
        guard refusal == nil else { return false }
        guard case .live(let currentApp) = app, currentApp == appIdentity else { return refuse(.identityUnverified) }
        guard let expectedInventory else { return refuse(.missingInventory) }
        guard let inventory, !requiredArtifacts.isEmpty,
              expectedInventory.root == configuration.bundleRoot, inventory == expectedInventory,
              inventory.taskRoot == DataPath(path: configuration.taskRoot, canonicalPath: configuration.taskRoot,
                                             owner: configuration.owner, kind: .directory),
              inventory.taskRootPermissions == 0o700,
              inventory.canonicalRoot == inventory.root, inventory.owner == configuration.owner, inventory.rootKind == .directory,
              requiredArtifacts.isSubset(of: Set(inventory.entries.keys)),
              inventory.entries.allSatisfy({ relative, artifact in
                  Self.validArtifact(relative, artifact: artifact, root: inventory.root, owner: configuration.owner)
                    && Self.hasDirectoryParents(relative, entries: inventory.entries)
                    && Self.hasKnownSymlinkTarget(artifact, entries: inventory.entries)
              }) else { return refuse(.artifactDrift) }
        return true
    }

    /// Mutable data has no content hash requirement. Validate the entire path
    /// chain from one captured data root, including every existing parent.
    mutating func validateDataPath(
        root: String, chain: [DataPath], leaf: DataKind, allowMissingLeaf: Bool,
        app: Observation, inventory: Inventory?
    ) -> Bool {
        guard validateBoundary(app: app, inventory: inventory) else { return false }
        guard [configuration.runtimeHome, configuration.logsDirectory].contains(root),
              !chain.isEmpty, chain.first?.path == root, chain.first?.kind == .directory,
              leaf == .directory || leaf == .regularFile else { return refuse(.invalidDataPath) }
        for (index, item) in chain.enumerated() {
            guard Self.isCanonicalAbsolute(item.path), item.path == item.canonicalPath,
                  item.owner == configuration.owner,
                  item.path == root || Self.isInside(item.path, root: root) else { return refuse(.invalidDataPath) }
            if index > 0, Self.parent(item.path) != chain[index - 1].path { return refuse(.invalidDataPath) }
            let last = index == chain.count - 1
            if last {
                guard item.kind == leaf || (allowMissingLeaf && item.kind == .missing && index > 0) else {
                    return refuse(.invalidDataPath)
                }
            } else if item.kind != .directory { return refuse(.invalidDataPath) }
        }
        return true
    }

    /// Only the caller's actual successful Process.run handle may supply
    /// serviceRun. Discovery results must never be converted to that origin.
    mutating func enroll(
        handleID: UUID, attempt: Int, purpose: String, origin: Origin,
        initial: Identity, commands: [Command], app: Observation, inventory: Inventory?
    ) -> UUID? {
        guard validateBoundary(app: app, inventory: inventory) else { return nil }
        guard origin == .serviceRun else { refuse(.externalEnrollment); return nil }
        guard initial.isValid, initial.pid != appIdentity.pid,
              initial.parentPID == appIdentity.pid, initial.groupID == appIdentity.pid,
              initial.realUserID == configuration.owner, initial.effectiveUserID == configuration.owner,
              initial.creation >= appIdentity.creation, attempt > 0, !purpose.isEmpty,
              !commands.isEmpty, commands.allSatisfy(\.isValid), commands.first == initial.command,
              !enrollments.values.contains(where: { $0.handleID == handleID || (!$0.verifiedExited && $0.initial.pid == initial.pid) }) else {
            refuse(.invalidEnrollment); return nil
        }
        let token = UUID()
        enrollments[token] = Enrollment(token: token, handleID: handleID, attempt: attempt, purpose: purpose,
                                        initial: initial, commands: commands, commandIndex: 0, verifiedExited: false)
        return token
    }

    mutating func signalDecision(
        token: UUID, handleID: UUID, attempt: Int, observation: Observation,
        app: Observation, inventory: Inventory?
    ) -> SignalDecision {
        guard validateBoundary(app: app, inventory: inventory) else { return .refused(refusal!) }
        guard let record = enrollments[token], record.handleID == handleID, record.attempt == attempt else {
            refuse(.invalidEnrollment); return .refused(refusal!)
        }
        return inspect(token: token, observation: observation)
    }

    private mutating func inspect(token: UUID, observation: Observation) -> SignalDecision {
        guard var record = enrollments[token] else { refuse(.invalidEnrollment); return .refused(refusal!) }
        if record.verifiedExited { return .gone }
        switch observation {
        case .unknown:
            refuse(.identityUnverified)
        case .exited(let pid):
            guard pid == record.initial.pid else { refuse(.identityUnverified); return .refused(refusal!) }
            record.verifiedExited = true
            enrollments[token] = record
            return .gone
        case .live(let current):
            guard current.isValid, current.pid == record.initial.pid else {
                refuse(.identityUnverified); return .refused(refusal!)
            }
            if current.creation != record.initial.creation {
                // A reused PID proves only that our original creation ended.
                // Never signal or enroll its replacement.
                record.verifiedExited = true
                enrollments[token] = record
                return .gone
            }
            guard current.parentPID == record.initial.parentPID, current.groupID == record.initial.groupID,
                  current.realUserID == record.initial.realUserID, current.effectiveUserID == record.initial.effectiveUserID,
                  let index = record.commands[record.commandIndex...].firstIndex(of: current.command) else {
                refuse(.identityChanged); return .refused(refusal!)
            }
            record.commandIndex = index
            enrollments[token] = record
            return .signal(current.pid)
        }
        return .refused(refusal!)
    }

    mutating func authorizeAPI(
        requestedURL: String, running: Bool, token: UUID, handleID: UUID, attempt: Int,
        observation: Observation, app: Observation, inventory: Inventory?
    ) -> Bool {
        guard refusal == nil else { return false }
        guard requestedURL == configuration.apiURL, running, enrollments[token]?.purpose == "api" else { return refuse(.apiNotOwned) }
        guard case .signal = signalDecision(token: token, handleID: handleID, attempt: attempt,
                                           observation: observation, app: app, inventory: inventory) else {
            return refuse(.apiNotOwned)
        }
        return true
    }

    /// Must be called again after every await/escalation; uncertain cleanup
    /// cannot authorize retries, data deletion or a successful stopped state.
    mutating func cleanupComplete(observations: [UUID: Observation], app: Observation, inventory: Inventory?) -> Bool {
        guard validateBoundary(app: app, inventory: inventory) else { return false }
        guard Set(observations.keys) == Set(enrollments.keys) else { return refuse(.identityUnverified) }
        var live = false
        for token in Array(enrollments.keys) {
            switch inspect(token: token, observation: observations[token]!) {
            case .gone: break
            case .signal: live = true
            case .refused: return false
            }
        }
        return live ? refuse(.childrenStillLive) : true
    }

    var allowsAlertStream: Bool { false }

    func resolvedState(_ requested: LifecycleState) -> LifecycleState {
        refusal == nil ? requested : .failed
    }

    private static func validArtifact(_ relative: String, artifact: Artifact, root: String, owner: UInt32) -> Bool {
        guard !relative.hasPrefix("/"), isCanonicalAbsolute("/" + relative), artifact.owner == owner else { return false }
        let path = root + "/" + relative
        switch artifact.kind {
        case .directory:
            return artifact.canonicalPath == path
        case .file(let digest):
            return artifact.canonicalPath == path && digest.count == 64
                && digest.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
        case .symlink(let target):
            guard !target.isEmpty, !target.hasPrefix("/"), !target.contains("\0") else { return false }
            var parts = parent(path).split(separator: "/").map(String.init)
            for part in target.split(separator: "/", omittingEmptySubsequences: false) {
                if part == ".." { guard !parts.isEmpty else { return false }; parts.removeLast() }
                else if part != "." && !part.isEmpty { parts.append(String(part)) }
            }
            let resolved = "/" + parts.joined(separator: "/")
            return isInside(resolved, root: root) && artifact.canonicalPath == resolved
        }
    }

    private static func isCanonicalAbsolute(_ path: String) -> Bool {
        path.hasPrefix("/") && path != "/" && !path.contains("\0")
            && path.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
                .allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    private static func hasDirectoryParents(_ relative: String, entries: [String: Artifact]) -> Bool {
        let parts = relative.split(separator: "/")
        guard parts.count > 1 else { return true }
        for count in 1..<parts.count {
            guard entries[parts.prefix(count).joined(separator: "/")]?.kind == .directory else { return false }
        }
        return true
    }

    private static func hasKnownSymlinkTarget(_ artifact: Artifact, entries: [String: Artifact]) -> Bool {
        guard case .symlink = artifact.kind else { return true }
        return entries.values.contains { target in
            guard target.canonicalPath == artifact.canonicalPath else { return false }
            switch target.kind {
            case .directory, .file: return true
            case .symlink: return false
            }
        }
    }

    private static func isInside(_ path: String, root: String) -> Bool { path.hasPrefix(root + "/") }

    private static func parent(_ path: String) -> String { String(path.prefix(upTo: path.lastIndex(of: "/")!)) }

    private static func isLoopbackAPI(_ value: String) -> Bool {
        guard let c = URLComponents(string: value) else { return false }
        return c.scheme == "http" && c.host == "127.0.0.1" && c.user == nil && c.password == nil
            && c.path.isEmpty && c.query == nil && c.fragment == nil && c.port.map { (1024...65535).contains($0) } == true
    }
}
