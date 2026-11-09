import SwiftUI

// MARK: - App State

/// Central observable state for the application.
/// Owns long-lived services plus feature-scoped child state models.
@MainActor @Observable
final class AppState {
    private static let connectionStaleSecretsCleanupVersionKey =
        "appState.didRunStaleSecretsCleanup.connection.v1"
    private static let copilotStaleSecretsCleanupVersionKey =
        "appState.didRunStaleSecretsCleanup.copilot.v1"

    private let launchPolicy: AppLaunchPolicy

    var isIsolatedSmokeLaunch: Bool { launchPolicy.requiresSmokeBoundary }

    let navigationState: NavigationState
    let connectionState: ConnectionState
    let runtimeState: RuntimeState
    let alertsState: AlertsState
    let copilotSettingsState: CopilotSettingsState

    // MARK: - Services

    let apiClient: APIClient
    let alertStream = AlertStreamService()
    let localCache = LocalCache()

    @ObservationIgnored
    private let launchMode: AppLaunchMode

    @ObservationIgnored
    private var didPerformInitialLaunch = false

    @ObservationIgnored
    private var managedRuntimeTransitionTask: Task<Bool, Never>?

    @ObservationIgnored
    private var managedRuntimeTransitionID: UUID?

    // MARK: - Compatibility Forwards

    var selectedNavItem: NavigationItem {
        get { navigationState.selectedNavItem }
        set { navigationState.selectedNavItem = newValue }
    }

    var deepLinkListingId: Int? {
        get { navigationState.deepLinkListingId }
        set { navigationState.deepLinkListingId = newValue }
    }

    var deepLinkOutreachThreadId: Int? {
        get { navigationState.deepLinkOutreachThreadId }
        set { navigationState.deepLinkOutreachThreadId = newValue }
    }

    var connectionStatus: ConnectionStatus {
        get { connectionState.connectionStatus }
        set { connectionState.connectionStatus = newValue }
    }

    var bundledLaunchExperienceState: BundledLaunchExperienceState {
        get { runtimeState.bundledLaunchExperienceState }
        set { runtimeState.bundledLaunchExperienceState = newValue }
    }

    var unreadAlertCount: Int {
        get { alertsState.unreadAlertCount }
        set { alertsState.unreadAlertCount = newValue }
    }

    var settingsErrorMessage: String? {
        let connectionError = connectionState.settingsErrorMessage
        let runtimeError = runtimeState.settingsErrorMessage
        let copilotError = copilotSettingsState.settingsErrorMessage
        return connectionError ?? runtimeError ?? copilotError
    }

    var hasCompletedBundledSetup: Bool {
        get { runtimeState.hasCompletedBundledSetup }
        set { runtimeState.hasCompletedBundledSetup = newValue }
    }

    var hasEnabledMonitoring: Bool {
        get { runtimeState.hasEnabledMonitoring }
        set { runtimeState.hasEnabledMonitoring = newValue }
    }

    var hasDismissedInitialMonitoringPrompt: Bool {
        get { runtimeState.hasDismissedInitialMonitoringPrompt }
        set { runtimeState.hasDismissedInitialMonitoringPrompt = newValue }
    }

    var apiBaseURL: String {
        get { connectionState.apiBaseURL }
        set { connectionState.updateAPIBaseURL(newValue) }
    }

    var apiToken: String { connectionState.apiToken }

    /// True when the Keychain refused to read the stored API token.
    var isAPITokenUnreadable: Bool { connectionState.isAPITokenUnreadable }

    var refreshIntervalSeconds: Int {
        get { connectionState.refreshIntervalSeconds }
        set {
            connectionState.refreshIntervalSeconds = newValue
            startBackgroundRefreshTasksIfNeeded()
        }
    }

    var notificationsEnabled: Bool {
        get { alertsState.notificationsEnabled }
        set { alertsState.notificationsEnabled = newValue }
    }

    var notifyOnNewMatch: Bool {
        get { alertsState.notifyOnNewMatch }
        set { alertsState.notifyOnNewMatch = newValue }
    }

    var notifyOnPriceDrop: Bool {
        get { alertsState.notifyOnPriceDrop }
        set { alertsState.notifyOnPriceDrop = newValue }
    }

    var notifyOnScoreChange: Bool {
        get { alertsState.notifyOnScoreChange }
        set { alertsState.notifyOnScoreChange = newValue }
    }

    var copilotProvider: CopilotProvider {
        get { copilotSettingsState.copilotProvider }
        set { copilotSettingsState.copilotProvider = newValue }
    }

    var anthropicApiKey: String { copilotSettingsState.anthropicApiKey }

    var openaiApiKey: String { copilotSettingsState.openaiApiKey }

    /// True when the Keychain refused to read this provider's stored key.
    func isCopilotKeyUnreadable(for provider: CopilotProvider) -> Bool {
        copilotSettingsState.isKeyUnreadable(for: provider)
    }

    var copilotModel: String {
        get { copilotSettingsState.copilotModel }
        set { copilotSettingsState.copilotModel = newValue }
    }

    /// Reset Local Engine asks first. ContentView shows the confirmation, and confirming it runs
    /// `resetLocalEngine()`.
    var isEngineResetConfirmationPresented = false

    /// Set when the connection fails or the engine restarts, so the next successful check asks the
    /// feature views, which keep their state, to reload.
    @ObservationIgnored
    private var needsFeatureRefresh = false

    var hasActiveBackgroundRefreshTasks: Bool {
        connectionState.hasActiveRefreshTask
    }

    var allowsAutomaticFeatureLoads: Bool {
        launchPolicy.allowsAutomaticFeatureLoads
    }

    var usesManagedLocalRuntime: Bool {
        LocalRuntimeAuth.isLoopbackBaseURL(connectionState.apiBaseURL)
    }

    var preferredLocalRuntimeBootMode: LocalRuntimeService.BootMode {
        runtimeState.preferredLocalRuntimeBootMode
    }

    var isLocalEngineBusy: Bool {
        runtimeState.localRuntime.isBusy
    }

    var shouldPresentBundledLaunchExperience: Bool {
        runtimeState.shouldPresentBundledLaunchExperience(usesManagedLocalRuntime: usesManagedLocalRuntime)
    }

    var shouldShowMonitoringPausedBanner: Bool {
        runtimeState.shouldShowMonitoringPausedBanner(usesManagedLocalRuntime: usesManagedLocalRuntime)
    }

    var localEngineExperienceState: LocalEngineExperienceState {
        runtimeState.localEngineExperienceState(usesManagedLocalRuntime: usesManagedLocalRuntime)
    }

    /// Why the local engine can't run a source right now, if it can't.
    var sourceRunBlockedReason: String? {
        switch localEngineExperienceState {
        case .externalConnection, .monitoringActive:
            return nil
        case .monitoringHeld(let reason):
            return reason
        case .ready, .monitoringPaused:
            return "Start monitoring to run this source"
        case .starting, .needsAttention:
            return "The local engine isn’t ready"
        }
    }

    var localRuntimeDiagnostics: LocalRuntimeService.DiagnosticsSummary {
        runtimeState.localRuntimeDiagnostics
    }

    var localRuntime: LocalRuntimeService {
        runtimeState.localRuntime
    }

    /// Any failure of the live connection, a dependency that is down, or a rejected alert stream
    /// shows here.
    var globalConnectionWarningMessage: String? {
        guard !shouldPresentBundledLaunchExperience else { return nil }
        if let connectionIssue = connectionState.connectionIssue {
            return connectionIssue
        }
        guard alertStream.isUnauthorized else { return nil }
        return usesManagedLocalRuntime
            ? "The local engine rejected this app’s token, so new alerts can’t arrive. Click Retry to restart the engine."
            : "The server rejected this app’s API token, so new alerts can’t arrive. Check the API token in Settings."
    }

    /// The API key stored for the selected Copilot provider.
    var activeCopilotApiKey: String {
        guard launchPolicy.allowsStoredCredentials else { return "" }
        return copilotSettingsState.activeAPIKey()
    }

    /// Whether a Copilot API key is stored, or nil while that isn't known.
    var hasCopilotAPIKey: Bool? {
        guard launchPolicy.allowsStoredCredentials else { return nil }
        return copilotSettingsState.hasAPIKeyForActiveProvider
    }

    // MARK: - Init

    init(launchMode: AppLaunchMode = .current, smokeContext: IsolatedSmokeContext? = nil) {
        self.launchMode = launchMode
        let launchPolicy = AppLaunchPolicy(mode: launchMode, smokeContext: smokeContext)
        self.launchPolicy = launchPolicy

        let navigationState = NavigationState()
        let connectionState = ConnectionState()
        let runtimeState = RuntimeState(
            isSmokeTest: launchPolicy.requiresSmokeBoundary,
            smokeStartsMonitoring: smokeContext?.startsMonitoring ?? false,
            localRuntime: LocalRuntimeService(smokeContext: smokeContext, launchMode: launchMode)
        )
        let alertsState = AlertsState()
        let copilotSettingsState = CopilotSettingsState()

        self.navigationState = navigationState
        self.connectionState = connectionState
        self.runtimeState = runtimeState
        self.alertsState = alertsState
        self.copilotSettingsState = copilotSettingsState

        let initialAuthToken = launchPolicy.connectionToken {
            ConnectionState.initialStoredAuthToken(isSmokeTest: false)
        }

        self.apiClient = APIClient(
            baseURL: smokeContext?.apiBaseURL.absoluteString ?? connectionState.apiBaseURL,
            authToken: initialAuthToken
        )

        connectionState.onRefreshIntervalChange = { [weak self] in
            self?.startBackgroundRefreshTasksIfNeeded()
        }

        // Keeps the setting true to macOS. When notifications are on at launch, this asks the same
        // way Settings does: macOS prompts only if it never asked, and a denial, including one
        // made later in System Settings, turns the setting off with the same hint.
        if launchMode.shouldRequestNotificationPermission,
           smokeContext == nil,
           alertsState.notificationsEnabled {
            Task { [alertsState] in await alertsState.setNotificationsEnabled(true) }
        }

        if launchPolicy.allowsStoredCredentials {
            runSilentStaleSecretsCleanupIfNeeded()
        }
    }

    // MARK: - Settings

    func loadSettingsSecretsIfNeeded() {
        guard launchPolicy.allowsStoredCredentials else { return }
        connectionState.loadConnectionSecretsIfNeeded(allowUserInteraction: true)
        copilotSettingsState.loadCopilotSecretsIfNeeded(allowUserInteraction: true)
    }

    func loadConnectionSecretForUserAction() {
        guard launchPolicy.allowsStoredCredentials else { return }
        connectionState.loadConnectionSecretForUserAction()
    }

    /// Reads the Copilot keys without a Keychain prompt, so Copilot can say when none is stored.
    func loadCopilotKeysQuietly() {
        guard launchPolicy.allowsStoredCredentials else { return }
        copilotSettingsState.loadCopilotSecretsIfNeeded(allowUserInteraction: false)
    }

    func clearSettingsError() {
        connectionState.clearSettingsError()
        runtimeState.clearSettingsError()
        copilotSettingsState.clearSettingsError()
    }

    func testConnection(baseURL: String, token: String) async {
        guard launchPolicy.allowsStoredCredentials else { return }
        await connectionState.testConnection(baseURL: baseURL, token: token)
    }

    /// Saves the connection settings. A nil token leaves the stored token as it is, and an empty
    /// one deletes it.
    func applyConnectionSettings(baseURL: String, token: String?) async {
        guard launchPolicy.allowsStoredCredentials else { return }
        let previousBaseURL = connectionState.apiBaseURL
        let normalizedBaseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalizedBaseURL.isEmpty else {
            connectionState.settingsErrorMessage = "Base URL is required."
            return
        }

        clearSettingsError()

        if let token {
            let normalizedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
            guard connectionState.saveAPIToken(normalizedToken) else { return }
        }
        connectionState.updateAPIBaseURL(normalizedBaseURL)

        let appliedBaseURL = connectionState.apiBaseURL
        let appliedAuthToken = connectionState.resolvedConnectionAuthToken(
            for: appliedBaseURL,
            userToken: connectionState.apiToken,
            allowUserInteraction: true
        )

        await apiClient.updateBaseURL(appliedBaseURL)
        await apiClient.updateAuthToken(appliedAuthToken)

        alertsState.disconnectStream(alertStream)
        await refreshConnection()

        let movedBetweenRuntimeModes =
            LocalRuntimeAuth.isLoopbackBaseURL(previousBaseURL) != LocalRuntimeAuth.isLoopbackBaseURL(appliedBaseURL)
        if movedBetweenRuntimeModes {
            didPerformInitialLaunch = false
            runtimeState.bundledLaunchExperienceState = .checking

            if LocalRuntimeAuth.isLoopbackBaseURL(appliedBaseURL) {
                await performInitialLaunchIfNeeded()
            } else {
                runtimeState.bundledLaunchExperienceState = .ready
            }
        }

        startBackgroundRefreshTasksIfNeeded()
    }

    /// A nil key leaves the stored key as it is, and an empty one deletes it.
    func applyCopilotSettings(
        provider: CopilotProvider,
        anthropicKey: String?,
        openAIKey: String?,
        model: String
    ) async {
        guard launchPolicy.allowsStoredCredentials else { return }
        _ = await copilotSettingsState.applySettings(
            provider: provider,
            anthropicKey: anthropicKey,
            openAIKey: openAIKey,
            model: model
        )
    }

    func cleanupStoredSecrets() {
        guard launchPolicy.allowsStoredCredentials else { return }
        connectionState.cleanupStoredSecrets()
        copilotSettingsState.cleanupStoredSecrets()
    }

    func resolvedConnectionAuthToken(allowUserInteraction: Bool = true) -> String? {
        launchPolicy.connectionToken {
            connectionState.resolvedConnectionAuthToken(allowUserInteraction: allowUserInteraction)
        }
    }

    // MARK: - Background Refresh

    func startBackgroundRefreshTasksIfNeeded() {
        connectionState.startRefreshTaskIfNeeded(
            allowsBackgroundRefreshTasks: launchPolicy.allowsBackgroundRefresh
        ) { [weak self] in
            guard let self else { return }
            await self.refreshConnection()
        }
    }

    func stopBackgroundRefreshTasks() {
        connectionState.stopRefreshTask()
    }

    // MARK: - Navigation

    func navigateTo(_ item: NavigationItem) {
        navigationState.navigateTo(item)
    }

    /// Refresh Data: feature views reload, and the connection is checked again.
    func requestRefresh() {
        navigationState.requestRefresh()
        Task { await refreshConnection(userInitiated: true) }
    }

    func openListing(_ listingId: Int) {
        navigationState.openListing(listingId)
    }

    func openOutreachThread(_ threadId: Int) {
        navigationState.openOutreachThread(threadId)
    }

    // MARK: - Lifecycle

    func performInitialLaunchIfNeeded() async {
        guard !didPerformInitialLaunch else { return }
        didPerformInitialLaunch = true

        guard launchMode.allowsInitialLaunchSideEffects else {
            runtimeState.bundledLaunchExperienceState = .ready
            return
        }

        if usesManagedLocalRuntime {
            await runtimeState.localRuntime.refreshStatus(apiBaseURL: connectionState.apiBaseURL)
            _ = await startManagedLocalRuntime(
                restartExistingRuntime: false,
                userInitiated: false
            )
        } else {
            runtimeState.bundledLaunchExperienceState = .ready
            await refreshConnection()
        }

        startBackgroundRefreshTasksIfNeeded()
    }

    func retryBundledLaunch() async {
        guard usesManagedLocalRuntime else { return }
        _ = await startManagedLocalRuntime(
            // A degraded engine is still up, so only a restart gives what stopped another try.
            restartExistingRuntime: runtimeState.localRuntime.state.isDegraded,
            userInitiated: true
        )
    }

    func startMonitoring() async {
        await setMonitoring(.active)
    }

    func pauseMonitoring() async {
        await setMonitoring(.setup)
    }

    /// With the engine up this only starts or stops the workers, so nothing else needs a launch
    /// screen or a new connection.
    private func setMonitoring(_ bootMode: LocalRuntimeService.BootMode) async {
        guard usesManagedLocalRuntime else { return }

        // Recorded before any wait, because whichever start runs next reads it. After two quick
        // clicks, the last one wins.
        runtimeState.hasEnabledMonitoring = bootMode == .active
        runtimeState.hasDismissedInitialMonitoringPrompt = true

        while let managedRuntimeTransitionTask {
            _ = await managedRuntimeTransitionTask.value
        }

        if runtimeState.localRuntime.isEngineRunning {
            runtimeState.bundledLaunchExperienceState = .ready
            await runtimeState.localRuntime.start(
                apiBaseURL: connectionState.apiBaseURL,
                bootMode: preferredLocalRuntimeBootMode,
                policy: .ifNeeded
            )
        } else {
            _ = await startManagedLocalRuntime(
                restartExistingRuntime: true,
                userInitiated: true
            )
        }
    }

    func restartLocalEngine() async {
        guard usesManagedLocalRuntime else { return }
        _ = await startManagedLocalRuntime(
            restartExistingRuntime: true,
            userInitiated: true
        )
    }

    func dismissInitialMonitoringPrompt() {
        runtimeState.hasDismissedInitialMonitoringPrompt = true
        runtimeState.bundledLaunchExperienceState = .ready
    }

    func openLocalEngineDiagnostics() {
        navigationState.selectedNavItem = .sources
        runtimeState.bundledLaunchExperienceState = .ready
    }

    func openLocalEngineLogs() {
        runtimeState.openLocalEngineLogs()
    }

    func openLocalEngineDataFolder() {
        runtimeState.openLocalEngineDataFolder()
    }

    /// Every Reset Local Engine button calls this. Nothing is erased until the person confirms.
    func requestEngineReset() {
        guard usesManagedLocalRuntime, !isLocalEngineBusy else { return }
        isEngineResetConfirmationPresented = true
    }

    /// Erases the local engine. Only the confirmation that `requestEngineReset()` shows calls this.
    func resetLocalEngine() async {
        // Cleared before any wait, so a monitoring choice made during the reset is the one the new
        // engine starts with.
        runtimeState.hasEnabledMonitoring = false
        runtimeState.hasDismissedInitialMonitoringPrompt = false

        // A transition of its own, so every other engine action waits for the reset to finish.
        while let managedRuntimeTransitionTask {
            _ = await managedRuntimeTransitionTask.value
        }
        _ = await runManagedTransition { appState in
            await appState.performReset()
        }
    }

    private func performReset() async -> Bool {
        runtimeState.hasCompletedBundledSetup = false
        runtimeState.bundledLaunchExperienceState = .starting
        stopBackgroundRefreshTasks()
        alertsState.disconnectStream(alertStream)

        do {
            try await runtimeState.localRuntime.resetLocalEngine(apiBaseURL: connectionState.apiBaseURL)
        } catch {
            runtimeState.bundledLaunchExperienceState = .needsAttention(error.localizedDescription)
            startBackgroundRefreshTasksIfNeeded()
            return false
        }

        alertsState.unreadAlertCount = 0
        await apiClient.updateAuthToken(nil)

        return await performManagedLocalRuntimeTransition(
            restartExistingRuntime: false,
            userInitiated: true
        )
    }

    // MARK: - Connection / Alerts

    func refreshConnection(userInitiated: Bool = false) async {
        guard launchMode.allowsInitialLaunchSideEffects else { return }
        let authToken = launchPolicy.connectionToken {
            connectionState.loadConnectionSecretsIfNeeded(allowUserInteraction: userInitiated)
            return connectionState.resolvedConnectionAuthToken(allowUserInteraction: userInitiated)
        }
        await apiClient.updateAuthToken(authToken)

        // A poll of a working connection stays Connected. Only the first connect and a reconnect
        // after a failure show Connecting, and the banner keeps the last failure until it's fixed.
        if connectionState.connectionStatus != .connected {
            connectionState.connectionStatus = .connecting
        }

        // A smoke launch talks to its own API, so it doesn't probe the stored address.
        async let healthReport = Self.probeHealth(baseURL: isIsolatedSmokeLaunch ? nil : connectionState.apiBaseURL)
        let connectionResult = await apiClient.testConnection()
        let dependencyIssue = await healthReport?.issueMessage

        switch connectionResult {
        case .success:
            connectionState.connectionStatus = .connected
            connectionState.connectionIssue = dependencyIssue
            if needsFeatureRefresh {
                needsFeatureRefresh = false
                navigationState.requestRefresh()
            }
            reconcileManagedLocalRuntimeLaunchExperienceAfterSuccessfulConnection()
            if !isIsolatedSmokeLaunch {
                await alertsState.refreshUnreadCount(using: apiClient)
                alertsState.connectStreamIfNeeded(
                    alertStream,
                    baseURL: connectionState.apiBaseURL,
                    token: authToken
                )
            }
        case .failure(let error):
            // A named dependency says more than the unread-count request's own error.
            let message = dependencyIssue ?? AppErrorPresentation.message(for: error)
            connectionState.connectionStatus = .error(message)
            connectionState.connectionIssue = message
            needsFeatureRefresh = true
            alertsState.disconnectStream(alertStream)
        }
    }

    /// Off the main actor. Returns nil without a base URL, or when `/health` can't be read.
    private nonisolated static func probeHealth(baseURL: String?) async -> HealthProbe.Report? {
        guard let baseURL else { return nil }
        return await HealthProbe().check(baseURL: baseURL)
    }

    private func reconcileManagedLocalRuntimeLaunchExperienceAfterSuccessfulConnection() {
        guard usesManagedLocalRuntime,
              runtimeState.localRuntime.state == .running else {
            return
        }

        runtimeState.hasCompletedBundledSetup = true

        if runtimeState.hasEnabledMonitoring || runtimeState.hasDismissedInitialMonitoringPrompt {
            runtimeState.bundledLaunchExperienceState = .ready
        } else {
            runtimeState.bundledLaunchExperienceState = .readyToStartMonitoring
        }
    }

    func refreshUnreadCount() async {
        guard launchMode.allowsInitialLaunchSideEffects else { return }
        await alertsState.refreshUnreadCount(using: apiClient)
    }

    // MARK: - Internal Helpers

    private func startManagedLocalRuntime(
        restartExistingRuntime: Bool,
        userInitiated: Bool
    ) async -> Bool {
        var activeResult: Bool?
        while let managedRuntimeTransitionTask {
            activeResult = await managedRuntimeTransitionTask.value
        }
        if let activeResult, !restartExistingRuntime {
            return activeResult
        }

        return await runManagedTransition { appState in
            await appState.performManagedLocalRuntimeTransition(
                restartExistingRuntime: restartExistingRuntime,
                userInitiated: userInitiated
            )
        }
    }

    /// The caller has already waited for any transition in progress.
    private func runManagedTransition(
        _ transition: @escaping @MainActor (AppState) async -> Bool
    ) async -> Bool {
        let transitionID = UUID()
        let task = Task { @MainActor [weak self] () -> Bool in
            guard let self else { return false }
            defer {
                if self.managedRuntimeTransitionID == transitionID {
                    self.managedRuntimeTransitionTask = nil
                    self.managedRuntimeTransitionID = nil
                }
            }

            return await transition(self)
        }

        managedRuntimeTransitionID = transitionID
        managedRuntimeTransitionTask = task
        return await task.value
    }

    private func performManagedLocalRuntimeTransition(
        restartExistingRuntime: Bool,
        userInitiated: Bool
    ) async -> Bool {
        stopBackgroundRefreshTasks()
        defer { startBackgroundRefreshTasksIfNeeded() }

        guard usesManagedLocalRuntime else {
            runtimeState.bundledLaunchExperienceState = .ready
            await refreshConnection(userInitiated: userInitiated)
            return true
        }

        runtimeState.bundledLaunchExperienceState = .starting
        // The feature views stay up under the launch screen, so they reload once the engine answers.
        needsFeatureRefresh = true

        let startPolicy: LocalRuntimeService.StartPolicy = restartExistingRuntime ? .forceRestart : .ifNeeded
        await runtimeState.localRuntime.start(
            apiBaseURL: connectionState.apiBaseURL,
            bootMode: preferredLocalRuntimeBootMode,
            policy: startPolicy
        )
        await refreshConnection(userInitiated: userInitiated)

        switch runtimeState.localRuntime.state {
        case .failed(let message), .unavailable(let message):
            runtimeState.bundledLaunchExperienceState = .needsAttention(message)
            return false
        case .starting, .stopping, .stopped:
            runtimeState.bundledLaunchExperienceState = .needsAttention(
                "ImmoRadar couldn’t finish starting the local engine. Check diagnostics and try again."
            )
            return false
        case .running, .degraded:
            break
        }

        guard connectionState.connectionStatus == .connected else {
            runtimeState.bundledLaunchExperienceState = .needsAttention(
                "ImmoRadar started the local engine but couldn’t connect to it yet."
            )
            return false
        }

        runtimeState.hasCompletedBundledSetup = true

        if runtimeState.hasEnabledMonitoring || runtimeState.hasDismissedInitialMonitoringPrompt {
            runtimeState.bundledLaunchExperienceState = .ready
        } else {
            runtimeState.bundledLaunchExperienceState = .readyToStartMonitoring
        }

        return true
    }

    private func runSilentStaleSecretsCleanupIfNeeded() {
        connectionState.runSilentStaleSecretsCleanupIfNeeded(
            versionKey: Self.connectionStaleSecretsCleanupVersionKey
        )
        copilotSettingsState.runSilentStaleSecretsCleanupIfNeeded(
            versionKey: Self.copilotStaleSecretsCleanupVersionKey
        )
    }
}
