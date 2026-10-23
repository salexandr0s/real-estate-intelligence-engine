import Foundation
#if !IMMORADAR_OWNERSHIP_PROOF
import XCTest
@testable import ImmoRadar

final class SmokeRuntimeOwnershipTests: XCTestCase {
    func testInjectedOwnershipAndLifecycleDecisions() throws {
        XCTAssertFalse(try SmokeOwnershipProof.run().isEmpty)
    }
}
#endif

// Compile this file and SmokeRuntimeOwnership.swift with the proof flag only.
// All paths/identities/inventories are values; no files, processes, signals,
// credentials, network clients or application host are used by this proof.
enum SmokeOwnershipProof {
    typealias Policy = SmokeRuntimeOwnership
    struct Failure: Error { let check: String }

    private struct Fixture {
        let configuration: Policy.Configuration
        let app: Policy.Identity
        let child: Policy.Identity
        let inventory: Policy.Inventory
        let required: Set<String>
        let handle = UUID()

        init() {
            let root = "/private/tmp/immoradar-smoke.proof"
            let bundle = root + "/install/ImmoRadar.app"
            configuration = .init(taskRoot: root, bundleRoot: bundle, runtimeHome: root + "/runtime-home",
                                  logsDirectory: root + "/logs", apiURL: "http://127.0.0.1:49101", owner: 501)
            app = .init(pid: 100, parentPID: 1, groupID: 100, realUserID: 501, effectiveUserID: 501,
                        creation: .init(seconds: 10, microseconds: 25),
                        command: .init(executable: bundle + "/Contents/MacOS/ImmoRadar", arguments: [bundle + "/Contents/MacOS/ImmoRadar"]))
            let node = bundle + "/Contents/Resources/runtime/bin/node"
            child = .init(pid: 101, parentPID: 100, groupID: 100, realUserID: 501, effectiveUserID: 501,
                          creation: .init(seconds: 11, microseconds: 50),
                          command: .init(executable: node, arguments: [node, bundle + "/Contents/Resources/runtime/apps/api/dist/main.js"]))
            var entries: [String: Policy.Artifact] = [:]
            for path in ["Contents", "Contents/MacOS", "Contents/Resources", "Contents/Resources/runtime", "Contents/Resources/runtime/bin"] {
                entries[path] = .init(kind: .directory, owner: 501, canonicalPath: bundle + "/" + path)
            }
            required = ["Contents/MacOS/ImmoRadar", "Contents/Resources/runtime/manifest.json", "Contents/Resources/runtime/bin/node"]
            for path in required {
                entries[path] = .init(kind: .file(sha256: String(repeating: "a", count: 64)), owner: 501, canonicalPath: bundle + "/" + path)
            }
            inventory = .init(taskRoot: .init(path: root, canonicalPath: root, owner: 501, kind: .directory), taskRootPermissions: 0o700,
                              root: bundle, canonicalRoot: bundle, owner: 501, rootKind: .directory, entries: entries)
        }

        func policy(expected: Policy.Inventory? = nil, missing: Bool = false) -> Policy {
            Policy(configuration: configuration, appIdentity: app, expectedInventory: missing ? nil : expected ?? inventory,
                   requiredArtifacts: required)
        }

        func identity(
            _ base: Policy.Identity? = nil, pid: Int32? = nil, parent: Int32? = nil, group: Int32? = nil,
            realUser: UInt32? = nil, effectiveUser: UInt32? = nil, creation: Policy.Creation? = nil,
            command: Policy.Command? = nil
        ) -> Policy.Identity {
            let value = base ?? child
            return .init(pid: pid ?? value.pid, parentPID: parent ?? value.parentPID, groupID: group ?? value.groupID,
                         realUserID: realUser ?? value.realUserID, effectiveUserID: effectiveUser ?? value.effectiveUserID,
                         creation: creation ?? value.creation, command: command ?? value.command)
        }

        func enroll(_ policy: inout Policy, purpose: String = "api", initial: Policy.Identity? = nil, commands: [Policy.Command]? = nil) throws -> UUID {
            let initial = initial ?? child
            guard let token = policy.enroll(handleID: handle, attempt: 1, purpose: purpose, origin: .serviceRun,
                                            initial: initial, commands: commands ?? [initial.command],
                                            app: .live(app), inventory: inventory) else { throw Failure(check: "fixture enrollment") }
            return token
        }
    }

    static func run() throws -> [String] {
        let f = Fixture()
        var passed: [String] = []
        func check(_ name: String, _ condition: Bool) throws {
            guard condition else { throw Failure(check: name) }
            passed.append(name)
        }

        do {
            var policy = f.policy()
            let token = try f.enroll(&policy)
            try check("matching launch handle permits only positive owned PID", policy.signalDecision(token: token, handleID: f.handle, attempt: 1,
                observation: .live(f.child), app: .live(f.app), inventory: f.inventory) == .signal(101))
            try check("successful decisions keep enrollment history", policy.enrollments.count == 1 && policy.refusal == nil)
            try check("smoke never enables reconnecting alert stream", !policy.allowsAlertStream)
            try check("unrefused lifecycle state is preserved", policy.resolvedState(.running) == .running)
        }

        for (name, app) in [
            ("non-session-leader", f.identity(f.app, group: 99)), ("app owner", f.identity(f.app, realUser: 502)),
            ("app executable", f.identity(f.app, command: f.child.command)),
        ] {
            var policy = Policy(configuration: f.configuration, appIdentity: app, expectedInventory: f.inventory, requiredArtifacts: f.required)
            try check("invalid initial session: \(name)", policy.refusal == .invalidSession && !policy.validateBoundary(app: .live(app), inventory: f.inventory))
        }

        for origin: Policy.Origin in [.discovered, .registry, .portOrHealth, .externalHandle] {
            var policy = f.policy()
            let token = policy.enroll(handleID: f.handle, attempt: 1, purpose: "api", origin: origin, initial: f.child,
                                      commands: [f.child.command], app: .live(f.app), inventory: f.inventory)
            try check("external matching identity is never enrolled: \(origin)", token == nil && policy.enrollments.isEmpty && policy.refusal == .externalEnrollment)
        }

        let invalidEnrollments: [(String, Policy.Identity)] = [
            ("nonpositive PID", f.identity(pid: 0)), ("app PID", f.identity(pid: 100)),
            ("different parent", f.identity(parent: 99)), ("different group", f.identity(group: 99)),
            ("real owner", f.identity(realUser: 502)), ("effective owner", f.identity(effectiveUser: 502)),
            ("creation before app", f.identity(creation: .init(seconds: 9, microseconds: 0))),
            ("invalid microseconds", f.identity(creation: .init(seconds: 11, microseconds: 1_000_000))),
            ("invalid executable", f.identity(command: .init(executable: "relative/node", arguments: ["node"]))),
            ("NUL argv", f.identity(command: .init(executable: f.child.command.executable, arguments: ["bad\0arg"]))),
            ("oversized argv", f.identity(command: .init(executable: f.child.command.executable, arguments: [String(repeating: "x", count: 65_537)]))),
        ]
        for (name, initial) in invalidEnrollments {
            var policy = f.policy()
            let token = policy.enroll(handleID: f.handle, attempt: 1, purpose: "api", origin: .serviceRun, initial: initial,
                                      commands: [initial.command], app: .live(f.app), inventory: f.inventory)
            try check("reject invalid enrollment: \(name)", token == nil && policy.refusal == .invalidEnrollment)
        }
        for (name, attempt, purpose, commands) in [
            ("invalid attempt", 0, "api", [f.child.command]), ("empty purpose", 1, "", [f.child.command]),
            ("empty recipe", 1, "api", []), ("different initial command", 1, "api", [f.app.command]),
        ] {
            var policy = f.policy()
            let token = policy.enroll(handleID: f.handle, attempt: attempt, purpose: purpose, origin: .serviceRun,
                                      initial: f.child, commands: commands, app: .live(f.app), inventory: f.inventory)
            try check("reject enrollment: \(name)", token == nil && policy.refusal == .invalidEnrollment)
        }
        do {
            var policy = f.policy()
            _ = try f.enroll(&policy)
            let duplicate = policy.enroll(handleID: f.handle, attempt: 2, purpose: "migration", origin: .serviceRun, initial: f.child,
                                          commands: [f.child.command], app: .live(f.app), inventory: f.inventory)
            try check("no handle or live-PID reenrollment", duplicate == nil && policy.enrollments.count == 1)
        }

        let drifts: [(String, Policy.Identity)] = [
            ("parent", f.identity(parent: 1)), ("process group escape", f.identity(group: 999)),
            ("real user", f.identity(realUser: 0)), ("effective user", f.identity(effectiveUser: 0)),
            ("executable", f.identity(command: .init(executable: "/usr/bin/other", arguments: ["/usr/bin/other"]))),
            ("argv", f.identity(command: .init(executable: f.child.command.executable, arguments: [f.child.command.executable, "different.js"]))),
        ]
        for (name, current) in drifts {
            var policy = f.policy()
            let token = try f.enroll(&policy)
            let decision = policy.signalDecision(token: token, handleID: f.handle, attempt: 1, observation: .live(current), app: .live(f.app), inventory: f.inventory)
            try check("same creation drift refuses, never gone: \(name)", decision == .refused(.identityChanged)
                && policy.enrollments[token]?.verifiedExited == false && policy.enrollments.count == 1)
        }
        for current in [Policy.Observation.unknown, .live(f.identity(pid: 102)), .exited(pid: 102)] {
            var policy = f.policy()
            let token = try f.enroll(&policy)
            try check("unknown/wrong PID cannot authorize signal or cleanup: \(current)", policy.signalDecision(token: token, handleID: f.handle,
                attempt: 1, observation: current, app: .live(f.app), inventory: f.inventory) == .refused(.identityUnverified))
        }
        for mismatch in ["handle", "attempt", "token"] {
            var policy = f.policy()
            let token = try f.enroll(&policy)
            let decision = policy.signalDecision(token: mismatch == "token" ? UUID() : token, handleID: mismatch == "handle" ? UUID() : f.handle,
                attempt: mismatch == "attempt" ? 2 : 1, observation: .live(f.child), app: .live(f.app), inventory: f.inventory)
            try check("signal requires enrolled \(mismatch)", decision == .refused(.invalidEnrollment) && policy.enrollments.count == 1)
        }
        for gone in [Policy.Observation.exited(pid: 101), .live(f.identity(creation: .init(seconds: 12, microseconds: 0)))] {
            var policy = f.policy()
            let token = try f.enroll(&policy)
            let decision = policy.signalDecision(token: token, handleID: f.handle, attempt: 1, observation: gone, app: .live(f.app), inventory: f.inventory)
            try check("verified exit/PID reuse never signals replacement: \(gone)", decision == .gone && policy.enrollments[token]?.verifiedExited == true)
        }
        do {
            var policy = f.policy()
            let shell = f.identity(command: .init(executable: "/bin/bash", arguments: ["/bin/bash", f.configuration.bundleRoot + "/Contents/Resources/runtime/scripts/run-migrations.sh"]))
            let token = try f.enroll(&policy, purpose: "migration", initial: shell, commands: [shell.command, f.child.command])
            try check("one-shot migration has an enrolled shell identity", policy.enrollments[token]?.purpose == "migration")
            try check("exact declared shell-to-Node exec transition", policy.signalDecision(token: token, handleID: f.handle, attempt: 1,
                observation: .live(f.child), app: .live(f.app), inventory: f.inventory) == .signal(101))
            try check("exec transition cannot revert to previous recipe", policy.signalDecision(token: token, handleID: f.handle, attempt: 1,
                observation: .live(shell), app: .live(f.app), inventory: f.inventory) == .refused(.identityChanged))
        }

        let kernelCases: [(String, Int, Int, Policy.ReadError, Int32, Int32, Int, Policy.Identity?, Policy.Observation)] = [
            ("full live", 136, 136, .none, 101, 101, 2, f.child, .live(f.child)),
            ("ESRCH", 0, 136, .noSuchProcess, 101, 0, 0, nil, .exited(pid: 101)),
            ("verified zombie", 136, 136, .none, 101, 101, 5, f.child, .exited(pid: 101)),
            ("ambiguous zero", 0, 136, .none, 101, 0, 0, nil, .unknown),
            ("EPERM", 0, 136, .permissionDenied, 101, 0, 0, nil, .unknown),
            ("EIO", 0, 136, .ioFailure, 101, 0, 0, nil, .unknown),
            ("short read", 135, 136, .none, 101, 101, 2, f.child, .unknown),
            ("oversized read", 137, 136, .none, 101, 101, 2, f.child, .unknown),
            ("negative read", -1, 136, .other, 101, 0, 0, nil, .unknown),
            ("full bytes with error", 136, 136, .ioFailure, 101, 101, 2, f.child, .unknown),
            ("reported PID mismatch", 136, 136, .none, 101, 999, 2, f.child, .unknown),
            ("identity PID mismatch", 136, 136, .none, 101, 101, 2, f.identity(pid: 999), .unknown),
            ("nonpositive request", 0, 136, .noSuchProcess, 0, 0, 0, nil, .unknown),
            ("invalid expected size", 0, 0, .none, 101, 101, 2, f.child, .unknown),
            ("invalid status", 136, 136, .none, 101, 101, 0, f.child, .unknown),
            ("zombie without complete identity", 136, 136, .none, 101, 101, 5, nil, .unknown),
        ]
        for (name, count, expected, error, requested, reported, status, identity, result) in kernelCases {
            try check("injected kernel classification: \(name)", Policy.observation(byteCount: count, expectedByteCount: expected, error: error,
                requestedPID: requested, reportedPID: reported, kernelStatus: status, identity: identity) == result)
        }

        do {
            var policy = f.policy(missing: true)
            var effects = 0
            if policy.validateBoundary(app: .live(f.app), inventory: f.inventory) { effects += 1 }
            try check("missing authenticated inventory refuses before effect", effects == 0 && policy.refusal == .missingInventory)
        }
        do {
            var policy = Policy(configuration: f.configuration, appIdentity: f.app, expectedInventory: f.inventory, requiredArtifacts: [])
            try check("empty required artifact set fails closed", !policy.validateBoundary(app: .live(f.app), inventory: f.inventory))
        }
        for (name, changed) in [
            ("session group", f.identity(f.app, group: 999)), ("app exec", f.identity(f.app, command: f.child.command)),
            ("app owner", f.identity(f.app, effectiveUser: 502)), ("app creation", f.identity(f.app, creation: .init(seconds: 20, microseconds: 0))),
        ] {
            var policy = f.policy()
            try check("fresh app identity required: \(name)", !policy.validateBoundary(app: .live(changed), inventory: f.inventory) && policy.refusal == .identityUnverified)
        }

        var mutatedInventories: [(String, Policy.Inventory?)] = [("missing observed inventory", nil)]
        let nodePath = "Contents/Resources/runtime/bin/node"
        for name in ["changed Node with unchanged manifest", "missing Node", "extra file", "owner drift", "canonical escape", "relative escape", "symlink escape", "invalid digest", "missing directory parent", "symlink directory parent"] {
            var entries = f.inventory.entries
            let node = entries[nodePath]!
            switch name {
            case "changed Node with unchanged manifest": entries[nodePath] = .init(kind: .file(sha256: String(repeating: "b", count: 64)), owner: 501, canonicalPath: node.canonicalPath)
            case "missing Node": entries[nodePath] = nil
            case "extra file": entries["extra"] = .init(kind: .file(sha256: String(repeating: "a", count: 64)), owner: 501, canonicalPath: f.inventory.root + "/extra")
            case "owner drift": entries[nodePath] = .init(kind: node.kind, owner: 502, canonicalPath: node.canonicalPath)
            case "canonical escape": entries[nodePath] = .init(kind: node.kind, owner: 501, canonicalPath: "/external/node")
            case "relative escape": entries["../escape"] = node
            case "symlink escape": entries[nodePath] = .init(kind: .symlink(target: "../../../../../../external"), owner: 501, canonicalPath: "/external")
            case "missing directory parent": entries["Contents/Resources/runtime/bin"] = nil
            case "symlink directory parent": entries["Contents/Resources/runtime/bin"] = .init(kind: .symlink(target: "elsewhere"), owner: 501, canonicalPath: f.inventory.root + "/Contents/Resources/runtime/elsewhere")
            default: entries[nodePath] = .init(kind: .file(sha256: "unverified"), owner: 501, canonicalPath: node.canonicalPath)
            }
            mutatedInventories.append((name, .init(taskRoot: f.inventory.taskRoot, taskRootPermissions: 0o700,
                root: f.inventory.root, canonicalRoot: f.inventory.root, owner: 501, rootKind: .directory, entries: entries)))
        }
        for (name, inventory) in mutatedInventories {
            var policy = f.policy()
            try check("immutable artifact verification: \(name)", !policy.validateBoundary(app: .live(f.app), inventory: inventory) && policy.refusal == .artifactDrift)
        }
        for (name, invalid) in mutatedInventories.dropFirst() {
            // Matching malformed expected/observed data cannot bypass structural
            // validation merely by agreeing with itself.
            if name == "changed Node with unchanged manifest" || name == "extra file" { continue }
            var policy = f.policy(expected: invalid)
            try check("reject malformed matching inventory: \(name)", !policy.validateBoundary(app: .live(f.app), inventory: invalid))
        }
        for (name, canonical, owner, kind) in [
            ("escaped bundle root", "/external/bundle", UInt32(501), Policy.DataKind.directory),
            ("bundle root owner", f.inventory.root, UInt32(502), .directory),
            ("bundle root symlink", f.inventory.root, UInt32(501), .symlink),
            ("unknown bundle root", f.inventory.root, UInt32(501), .other),
        ] {
            let invalid = Policy.Inventory(taskRoot: f.inventory.taskRoot, taskRootPermissions: 0o700,
                root: f.inventory.root, canonicalRoot: canonical, owner: owner, rootKind: kind, entries: f.inventory.entries)
            var policy = f.policy(expected: invalid)
            try check("reject malformed matching root observation: \(name)", !policy.validateBoundary(app: .live(f.app), inventory: invalid) && policy.refusal == .artifactDrift)
        }
        for (name, target, canonical, accepted) in [
            ("contained exact symlink", "bin/node", f.inventory.root + "/" + nodePath, true),
            ("dangling internal symlink", "bin/missing", f.inventory.root + "/Contents/Resources/runtime/bin/missing", false),
        ] {
            var entries = f.inventory.entries
            entries["Contents/Resources/runtime/node-link"] = .init(kind: .symlink(target: target), owner: 501, canonicalPath: canonical)
            let inventory = Policy.Inventory(taskRoot: f.inventory.taskRoot, taskRootPermissions: 0o700,
                root: f.inventory.root, canonicalRoot: f.inventory.root, owner: 501, rootKind: .directory, entries: entries)
            var policy = f.policy(expected: inventory)
            try check("complete inventory symlink target: \(name)", policy.validateBoundary(app: .live(f.app), inventory: inventory) == accepted)
        }
        for (name, canonical, owner, kind, permissions) in [
            ("task root escape", "/external", UInt32(501), Policy.DataKind.directory, UInt16(0o700)),
            ("task root owner", f.configuration.taskRoot, UInt32(502), .directory, UInt16(0o700)),
            ("task root symlink", f.configuration.taskRoot, UInt32(501), .symlink, UInt16(0o700)),
            ("task root permissions", f.configuration.taskRoot, UInt32(501), .directory, UInt16(0o777)),
        ] {
            let inventory = Policy.Inventory(taskRoot: .init(path: f.configuration.taskRoot, canonicalPath: canonical, owner: owner, kind: kind),
                taskRootPermissions: permissions, root: f.inventory.root, canonicalRoot: f.inventory.root, owner: 501, rootKind: .directory, entries: f.inventory.entries)
            var policy = f.policy(expected: inventory)
            try check("fresh task-root parent identity: \(name)", !policy.validateBoundary(app: .live(f.app), inventory: inventory) && policy.refusal == .artifactDrift)
        }

        for name in ["lost ownership", "wrong URL", "not running", "missing artifact", "wrong purpose"] {
            var policy = f.policy()
            let token = try f.enroll(&policy, purpose: name == "wrong purpose" ? "migration" : "api")
            var network = 0
            let allowed = policy.authorizeAPI(requestedURL: name == "wrong URL" ? "http://127.0.0.1:49102" : f.configuration.apiURL,
                running: name != "not running", token: token, handleID: f.handle, attempt: 1,
                observation: name == "lost ownership" ? .unknown : .live(f.child), app: .live(f.app),
                inventory: name == "missing artifact" ? nil : f.inventory)
            if allowed { network += 1 }
            try check("consumer refusal makes zero API/read/stream callbacks: \(name)", network == 0 && !policy.allowsAlertStream && policy.refusal != nil)
        }
        do {
            var policy = f.policy()
            let token = try f.enroll(&policy)
            var reads = 0
            if policy.authorizeAPI(requestedURL: f.configuration.apiURL, running: true, token: token, handleID: f.handle, attempt: 1,
                                   observation: .live(f.child), app: .live(f.app), inventory: f.inventory) { reads += 1 }
            try check("owned smoke permits one guarded authenticated read", reads == 1)
            // An await completed after the API lost its identity: no follow-up.
            if policy.authorizeAPI(requestedURL: f.configuration.apiURL, running: true, token: token, handleID: f.handle, attempt: 1,
                                   observation: .unknown, app: .live(f.app), inventory: f.inventory) { reads += 1 }
            try check("post-await identity loss blocks further reads/SSE", reads == 1 && !policy.allowsAlertStream)
            let firstRefusal = policy.refusal
            _ = policy.refuse(.artifactDrift)
            for state: Policy.LifecycleState in [.starting, .running, .stopping, .stopped] {
                try check("late lifecycle callback preserves refused failure: \(state)", policy.resolvedState(state) == .failed && policy.refusal == firstRefusal)
            }
            try check("late verified exit cannot erase refusal/history", !policy.cleanupComplete(observations: [token: .exited(pid: 101)],
                app: .live(f.app), inventory: f.inventory) && policy.enrollments.count == 1 && policy.enrollments[token]?.verifiedExited == false)
        }
        for final: Policy.Observation in [.live(f.child), .unknown, .exited(pid: 101)] {
            var policy = f.policy()
            let token = try f.enroll(&policy, purpose: "migration")
            let complete = policy.cleanupComplete(observations: [token: final], app: .live(f.app), inventory: f.inventory)
            try check("cleanup/retry/reset requires all owned identities gone: \(final)", complete == (final == .exited(pid: 101)) && policy.enrollments.count == 1)
        }
        do {
            var policy = f.policy()
            _ = try f.enroll(&policy)
            try check("missing cleanup observation retains diagnostics", !policy.cleanupComplete(observations: [:], app: .live(f.app), inventory: f.inventory) && policy.refusal == .identityUnverified)
        }
        do {
            var policy = f.policy()
            let token = try f.enroll(&policy)
            try check("extra cleanup observation cannot become enrolled child", !policy.cleanupComplete(observations: [token: .exited(pid: 101), UUID(): .exited(pid: 999)],
                app: .live(f.app), inventory: f.inventory) && policy.enrollments.count == 1)
        }

        let dataRoot = f.configuration.runtimeHome
        let rootItem = Policy.DataPath(path: dataRoot, canonicalPath: dataRoot, owner: 501, kind: .directory)
        let dataDir = Policy.DataPath(path: dataRoot + "/data", canonicalPath: dataRoot + "/data", owner: 501, kind: .directory)
        let filePath = dataDir.path + "/fresh.sqlite"
        for kind: Policy.DataKind in [.regularFile, .missing] {
            var policy = f.policy()
            let leaf = Policy.DataPath(path: filePath, canonicalPath: filePath, owner: 501, kind: kind)
            try check("new mutable data is accepted without byte inventory: \(kind)", policy.validateDataPath(root: dataRoot,
                chain: [rootItem, dataDir, leaf], leaf: .regularFile, allowMissingLeaf: true, app: .live(f.app), inventory: f.inventory))
        }
        let invalidPaths: [(String, [Policy.DataPath])] = [
            ("symlink leaf", [rootItem, dataDir, .init(path: filePath, canonicalPath: filePath, owner: 501, kind: .symlink)]),
            ("wrong owner", [rootItem, dataDir, .init(path: filePath, canonicalPath: filePath, owner: 502, kind: .regularFile)]),
            ("canonical escape", [rootItem, dataDir, .init(path: filePath, canonicalPath: "/external/data", owner: 501, kind: .regularFile)]),
            ("unknown file type", [rootItem, dataDir, .init(path: filePath, canonicalPath: filePath, owner: 501, kind: .other)]),
            ("missing ancestor", [rootItem, .init(path: filePath, canonicalPath: filePath, owner: 501, kind: .regularFile)]),
            ("substituted ancestor", [rootItem, .init(path: dataDir.path, canonicalPath: "/external", owner: 501, kind: .directory),
                                       .init(path: filePath, canonicalPath: filePath, owner: 501, kind: .regularFile)]),
            ("traversal path", [rootItem, .init(path: dataRoot + "/../escape", canonicalPath: dataRoot + "/../escape", owner: 501, kind: .regularFile)]),
        ]
        for (name, chain) in invalidPaths {
            var policy = f.policy()
            try check("mutable path guard: \(name)", !policy.validateDataPath(root: dataRoot, chain: chain, leaf: .regularFile,
                allowMissingLeaf: true, app: .live(f.app), inventory: f.inventory) && policy.refusal == .invalidDataPath)
        }
        do {
            var policy = f.policy()
            try check("foreign data root cannot be selected", !policy.validateDataPath(root: "/external",
                chain: [.init(path: "/external", canonicalPath: "/external", owner: 501, kind: .directory)],
                leaf: .directory, allowMissingLeaf: false, app: .live(f.app), inventory: f.inventory) && policy.refusal == .invalidDataPath)
        }
        do {
            var policy = f.policy()
            try check("missing leaf requires explicit create permission", !policy.validateDataPath(root: dataRoot,
                chain: [rootItem, dataDir, .init(path: filePath, canonicalPath: filePath, owner: 501, kind: .missing)],
                leaf: .regularFile, allowMissingLeaf: false, app: .live(f.app), inventory: f.inventory) && policy.refusal == .invalidDataPath)
        }
        do {
            var policy = f.policy(missing: true)
            try check("data/log path cannot bypass missing artifact authority", !policy.validateDataPath(root: dataRoot, chain: [rootItem],
                leaf: .directory, allowMissingLeaf: false, app: .live(f.app), inventory: f.inventory) && policy.refusal == .missingInventory)
        }
        do {
            var policy = f.policy()
            let logs = f.configuration.logsDirectory
            try check("captured logs root accepts legitimate new file", policy.validateDataPath(root: logs,
                chain: [.init(path: logs, canonicalPath: logs, owner: 501, kind: .directory),
                        .init(path: logs + "/new.log", canonicalPath: logs + "/new.log", owner: 501, kind: .missing)],
                leaf: .regularFile, allowMissingLeaf: true, app: .live(f.app), inventory: f.inventory))
        }
        return passed
    }
}

#if IMMORADAR_OWNERSHIP_PROOF
@main
enum SmokeOwnershipProofMain {
    static func main() throws {
        let passed = try SmokeOwnershipProof.run()
        for name in passed { print("PASS \(name)") }
        print("\(passed.count)/\(passed.count) pure ownership checks passed")
    }
}
#endif
