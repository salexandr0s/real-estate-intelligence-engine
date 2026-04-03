import AppKit
import Foundation

@MainActor
enum BundledLaunchExperienceState: Equatable {
    case checking
    case starting
    case readyToStartMonitoring
    case ready
    case needsAttention(String)
}

@MainActor
enum LocalEngineExperienceState: Equatable {
    case externalConnection
    case starting
    case ready
    case monitoringPaused
    case monitoringActive
    case needsAttention
}

@MainActor @Observable
final class RuntimeState {
    private enum PreferenceKey {
        static let bundledSetupCompleted = "bundledSetup.completed"
        static let monitoringEnabled = "bundledSetup.monitoringEnabled"
        static let monitoringPromptDismissed = "bundledSetup.monitoringPromptDismissed"
    }

    @ObservationIgnored
    private let isSmokeTest: Bool

    @ObservationIgnored
    private var statusRefreshTask: Task<Void, Never>?

    let localRuntime: LocalRuntimeService
    var settingsErrorMessage: String?

    var bundledLaunchExperienceState: BundledLaunchExperienceState = .checking

    var hasCompletedBundledSetup: Bool {
        didSet {
            guard !isSmokeTest else { return }
            UserDefaults.standard.set(hasCompletedBundledSetup, forKey: PreferenceKey.bundledSetupCompleted)
        }
    }

    var hasEnabledMonitoring: Bool {
        didSet {
            guard !isSmokeTest else { return }
            UserDefaults.standard.set(hasEnabledMonitoring, forKey: PreferenceKey.monitoringEnabled)
        }
    }

    var hasDismissedInitialMonitoringPrompt: Bool {
        didSet {
            guard !isSmokeTest else { return }
            UserDefaults.standard.set(
                hasDismissedInitialMonitoringPrompt,
                forKey: PreferenceKey.monitoringPromptDismissed
            )
        }
    }

    var hasActiveStatusRefreshTask: Bool {
        statusRefreshTask != nil
    }

    var preferredLocalRuntimeBootMode: LocalRuntimeService.BootMode {
        hasEnabledMonitoring ? .active : .setup
    }

    init(isSmokeTest: Bool, localRuntime: LocalRuntimeService = LocalRuntimeService()) {
        self.isSmokeTest = isSmokeTest
        self.localRuntime = localRuntime
        self.hasCompletedBundledSetup = isSmokeTest
            ? false
            : UserDefaults.standard.bool(forKey: PreferenceKey.bundledSetupCompleted)
        self.hasEnabledMonitoring = isSmokeTest
            ? false
            : UserDefaults.standard.bool(forKey: PreferenceKey.monitoringEnabled)
        self.hasDismissedInitialMonitoringPrompt = isSmokeTest
            ? false
            : UserDefaults.standard.bool(forKey: PreferenceKey.monitoringPromptDismissed)
    }

    func shouldPresentBundledLaunchExperience(usesManagedLocalRuntime: Bool) -> Bool {
        guard usesManagedLocalRuntime else { return false }

        switch bundledLaunchExperienceState {
        case .checking, .starting, .readyToStartMonitoring, .needsAttention:
            return true
        case .ready:
            return false
        }
    }

    func shouldShowMonitoringPausedBanner(usesManagedLocalRuntime: Bool) -> Bool {
        guard usesManagedLocalRuntime,
              hasCompletedBundledSetup,
              !hasEnabledMonitoring,
              hasDismissedInitialMonitoringPrompt,
              bundledLaunchExperienceState == .ready else {
            return false
        }

        return localRuntime.state == .running
    }

    func localEngineExperienceState(usesManagedLocalRuntime: Bool) -> LocalEngineExperienceState {
        guard usesManagedLocalRuntime else { return .externalConnection }

        switch bundledLaunchExperienceState {
        case .checking, .starting:
            return .starting
        case .readyToStartMonitoring:
            return .ready
        case .needsAttention:
            return .needsAttention
        case .ready:
            switch localRuntime.state {
            case .starting, .stopping:
                return .starting
            case .unavailable, .failed:
                return .needsAttention
            case .running:
                return hasEnabledMonitoring ? .monitoringActive : .monitoringPaused
            case .stopped:
                return hasCompletedBundledSetup ? .needsAttention : .starting
            }
        }
    }

    func localRuntimeDiagnostics(apiBaseURL: String) -> LocalRuntimeService.DiagnosticsSummary {
        localRuntime.diagnosticsSummary(apiBaseURL: apiBaseURL)
    }

    func clearSettingsError() {
        settingsErrorMessage = nil
    }

    func startStatusRefreshTaskIfNeeded(
        allowsBackgroundRefreshTasks: Bool,
        usesManagedLocalRuntime: Bool,
        apiBaseURL: String
    ) {
        stopStatusRefreshTask()
        guard allowsBackgroundRefreshTasks, usesManagedLocalRuntime else { return }

        statusRefreshTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else { break }
                await self.localRuntime.refreshStatus(apiBaseURL: apiBaseURL)
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    func stopStatusRefreshTask() {
        statusRefreshTask?.cancel()
        statusRefreshTask = nil
    }

    func openLocalEngineLogs() {
        let logsURL = LocalRuntimeService.logsDirectoryURL
        do {
            try FileManager.default.createDirectory(
                at: logsURL,
                withIntermediateDirectories: true,
                attributes: nil
            )
            NSWorkspace.shared.activateFileViewerSelecting([logsURL])
        } catch {
            settingsErrorMessage = "Couldn’t reveal local engine logs. \(error.localizedDescription)"
        }
    }

    func openLocalEngineDataFolder() {
        let runtimeURL = LocalRuntimeService.runtimeHomeURL
        do {
            try FileManager.default.createDirectory(
                at: runtimeURL,
                withIntermediateDirectories: true,
                attributes: nil
            )
            NSWorkspace.shared.activateFileViewerSelecting([runtimeURL])
        } catch {
            settingsErrorMessage = "Couldn’t reveal the local engine data folder. \(error.localizedDescription)"
        }
    }
}
