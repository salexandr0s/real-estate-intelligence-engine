import AppKit
import Foundation

/// Conditions that keep the workers stopped while monitoring is on, because a fanless Mac shouldn't
/// carry a crawl while it sleeps, runs hot or saves power. Postgres, Redis and the API keep running.
struct WorkerHolds: Equatable {
    enum Reason: CaseIterable, Hashable {
        case heat
        case lowPower
        case sleep

        /// How long the condition must stay clear before the workers return.
        var resumeDelay: Duration {
            switch self {
            case .heat, .lowPower: return .seconds(300)
            case .sleep: return .seconds(10)
            }
        }

        /// Holds true both during the condition and during the wait after it clears.
        var explanation: String {
            switch self {
            case .heat: return "Monitoring resumes about 5 minutes after this Mac cools down."
            case .lowPower: return "Monitoring resumes about 5 minutes after Low Power Mode turns off."
            case .sleep: return "Monitoring resumes a few seconds after this Mac wakes."
            }
        }
    }

    private(set) var active: Set<Reason> = []
    private(set) var resumesAt: ContinuousClock.Instant?
    private var waitingOn: Reason?

    var isHolding: Bool {
        !active.isEmpty || resumesAt != nil
    }

    var explanation: String? {
        (Reason.allCases.first(where: active.contains) ?? waitingOn)?.explanation
    }

    mutating func set(_ reason: Reason, isActive: Bool, now: ContinuousClock.Instant) {
        guard !isActive else {
            active.insert(reason)
            return
        }

        // The thermal state also reports changes between its cool levels. Those must not restart
        // the wait, or the workers might never return.
        guard active.remove(reason) != nil else { return }

        // A wake 10 seconds long must not cut short a 5-minute wait that is already running.
        let candidate = now + reason.resumeDelay
        if resumesAt.map({ candidate > $0 }) ?? true {
            resumesAt = candidate
            waitingOn = reason
        }
    }

    mutating func finishWait(now: ContinuousClock.Instant) {
        guard active.isEmpty, let resumesAt, now >= resumesAt else { return }
        self.resumesAt = nil
        waitingOn = nil
    }
}

/// Turns system notifications into hold changes.
@MainActor
final class WorkerHoldObserver {
    private var tokens: [any NSObjectProtocol] = []

    init(onChange: @escaping @MainActor (WorkerHolds.Reason, Bool) -> Void) {
        let workspace = NSWorkspace.shared.notificationCenter
        observe(workspace, NSWorkspace.willSleepNotification) { onChange(.sleep, true) }
        observe(workspace, NSWorkspace.didWakeNotification) { onChange(.sleep, false) }
        observe(.default, ProcessInfo.thermalStateDidChangeNotification) { onChange(.heat, Self.isHot) }
        observe(.default, .NSProcessInfoPowerStateDidChange) { onChange(.lowPower, Self.isSavingPower) }
    }

    /// What already applies when the app launches, since no notification will report it.
    var currentReasons: [WorkerHolds.Reason] {
        (Self.isHot ? [.heat] : []) + (Self.isSavingPower ? [.lowPower] : [])
    }

    private static var isHot: Bool {
        [.serious, .critical].contains(ProcessInfo.processInfo.thermalState)
    }

    private static var isSavingPower: Bool {
        ProcessInfo.processInfo.isLowPowerModeEnabled
    }

    private func observe(
        _ center: NotificationCenter,
        _ name: Notification.Name,
        handler: @escaping @MainActor () -> Void
    ) {
        tokens.append(center.addObserver(forName: name, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated(handler)
        })
    }
}
