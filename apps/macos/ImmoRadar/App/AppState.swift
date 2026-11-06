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

    var apiToken: String {
        get { connectionState.apiToken }
        set { connectionState.updateAPIToken(newValue) }
    }

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

    var anthropicApiKey: String {
        get { copilotSettingsState.anthropicApiKey }
        set { copilotSettingsState.anthropicApiKey = newValue }
    }

    var openaiApiKey: String {
        get { copilotSettingsState.openaiApiKey }
        set { copilotSettingsState.openaiApiKey = newValue }
    }

    var copilotModel: String {
        get { copilotSettingsState.copilotModel }
        set { copilotSettingsState.copilotModel = newValue }
    }

    var claudeSubscriptionAvailable: Bool {
        get { copilotSettingsState.claudeSubscriptionAvailable }
        set { copilotSettingsState.claudeSubscriptionAvailable = newValue }
    }

    var claudeSubscriptionType: String? {
        get { copilotSettingsState.claudeSubscriptionType }
        set { copilotSettingsState.claudeSubscriptionType = newValue }
    }

    var hasActiveBackgroundRefreshTasks: Bool {
        connectionState.hasActiveRefreshTask || runtimeState.hasActiveStatusRefreshTask
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

    var shouldPresentBundledLaunchExperience: Bool {
        runtimeState.shouldPresentBundledLaunchExperience(usesManagedLocalRuntime: usesManagedLocalRuntime)
    }

    var shouldShowMonitoringPausedBanner: Bool {
        runtimeState.shouldShowMonitoringPausedBanner(usesManagedLocalRuntime: usesManagedLocalRuntime)
    }

    var localEngineExperienceState: LocalEngineExperienceState {
        runtimeState.localEngineExperienceState(usesManagedLocalRuntime: usesManagedLocalRuntime)
    }

    var localRuntimeDiagnostics: LocalRuntimeService.DiagnosticsSummary {
        runtimeState.localRuntimeDiagnostics(apiBaseURL: connectionState.apiBaseURL)
    }

    var localRuntime: LocalRuntimeService {
        runtimeState.localRuntime
    }

    var globalConnectionWarningMessage: String? {
        guard !shouldPresentBundledLaunchExperience,
              let message = connectionState.connectionStatus.message else {
            return nil
        }

        let standardized = AppErrorPresentation.standardized(message: message)
        guard AppErrorPresentation.isConnectionIssue(message: standardized) else {
            return nil
        }

        return standardized
    }

    /// The active API key for the current provider, resolving Claude subscription OAuth.
    var activeCopilotApiKey: String {
        guard launchPolicy.allowsStoredCredentials else { return "" }
        return copilotSettingsState.activeAPIKey()
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

        if launchMode.shouldRequestNotificationPermission,
           smokeContext == nil,
           alertsState.notificationsEnabled {
            NotificationManager.shared.requestPermission()
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

    func loadClaudeSubscriptionIfNeeded() {
        guard launchPolicy.allowsStoredCredentials else { return }
        copilotSettingsState.loadClaudeSubscriptionIfNeeded()
    }

    func refreshClaudeSubscription() {
        guard launchPolicy.allowsStoredCredentials else { return }
        copilotSettingsState.refreshClaudeSubscription()
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

    func applyConnectionSettings(baseURL: String, token: String) async {
        guard launchPolicy.allowsStoredCredentials else { return }
        let previousBaseURL = connectionState.apiBaseURL
        let normalizedBaseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalizedBaseURL.isEmpty else {
            connectionState.settingsErrorMessage = "Base URL is required."
            return
        }

        clearSettingsError()

        guard connectionState.persistAPIToken(normalizedToken) else { return }

        connectionState.updateAPIToken(normalizedToken)
        connectionState.markSecretsLoaded(withUserInteraction: true)
        connectionState.updateAPIBaseURL(normalizedBaseURL)

        let appliedBaseURL = connectionState.apiBaseURL
        let appliedAuthToken = connectionState.resolvedConnectionAuthToken(
            for: appliedBaseURL,
            userToken: normalizedToken,
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

    func applyCopilotSettings(
        provider: CopilotProvider,
        anthropicKey: String,
        openAIKey: String,
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
        let allowsBackgroundRefreshTasks = launchPolicy.allowsBackgroundRefresh

        connectionState.startRefreshTaskIfNeeded(
            allowsBackgroundRefreshTasks: allowsBackgroundRefreshTasks
        ) { [weak self] in
            guard let self else { return }
            await self.refreshConnection()
        }

        runtimeState.startStatusRefreshTaskIfNeeded(
            allowsBackgroundRefreshTasks: allowsBackgroundRefreshTasks,
            usesManagedLocalRuntime: usesManagedLocalRuntime,
            apiBaseURL: connectionState.apiBaseURL
        )
    }

    func stopBackgroundRefreshTasks() {
        connectionState.stopRefreshTask()
        runtimeState.stopStatusRefreshTask()
    }

    // MARK: - Navigation

    func navigateTo(_ item: NavigationItem) {
        navigationState.navigateTo(item)
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
            if !isIsolatedSmokeLaunch {
                await runtimeState.localRuntime.refreshStatus(apiBaseURL: connectionState.apiBaseURL)
            }
            _ = await startManagedLocalRuntime(
                bootMode: preferredLocalRuntimeBootMode,
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
            bootMode: preferredLocalRuntimeBootMode,
            restartExistingRuntime: false,
            userInitiated: true
        )
    }

    func startMonitoring() async {
        guard usesManagedLocalRuntime else { return }

        let didStart = await startManagedLocalRuntime(
            bootMode: .active,
            restartExistingRuntime: true,
            userInitiated: true
        )

        guard didStart else { return }
        runtimeState.hasEnabledMonitoring = true
        runtimeState.hasDismissedInitialMonitoringPrompt = true
        runtimeState.bundledLaunchExperienceState = .ready
    }

    func pauseMonitoring() async {
        guard usesManagedLocalRuntime else { return }

        let didStart = await startManagedLocalRuntime(
            bootMode: .setup,
            restartExistingRuntime: true,
            userInitiated: true
        )

        guard didStart else { return }
        runtimeState.hasEnabledMonitoring = false
        runtimeState.hasDismissedInitialMonitoringPrompt = true
        runtimeState.bundledLaunchExperienceState = .ready
    }

    func restartLocalEngine() async {
        guard usesManagedLocalRuntime else { return }
        _ = await startManagedLocalRuntime(
            bootMode: preferredLocalRuntimeBootMode,
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

    func resetLocalEngine() async {
        runtimeState.bundledLaunchExperienceState = .starting
        stopBackgroundRefreshTasks()
        alertsState.disconnectStream(alertStream)

        do {
            try await runtimeState.localRuntime.resetLocalEngine(apiBaseURL: connectionState.apiBaseURL)
            runtimeState.hasCompletedBundledSetup = false
            runtimeState.hasEnabledMonitoring = false
            runtimeState.hasDismissedInitialMonitoringPrompt = false
            alertsState.unreadAlertCount = 0
            await apiClient.updateAuthToken(nil)

            _ = await startManagedLocalRuntime(
                bootMode: .setup,
                restartExistingRuntime: false,
                userInitiated: true
            )
        } catch {
            runtimeState.bundledLaunchExperienceState = .needsAttention(error.localizedDescription)
            startBackgroundRefreshTasksIfNeeded()
        }
    }

    // MARK: - Connection / Alerts

    /// Check before and after awaits. A token or successful health response is
    /// never ownership evidence, and a smoke refusal never starts read/stream work.
    private func permitsSmokeConnectionRead() -> Bool {
        guard isIsolatedSmokeLaunch else { return true }
        let ownedRead = runtimeState.localRuntime.permitsSmokeAPIRead(apiBaseURL: connectionState.apiBaseURL)
        guard let context = launchPolicy.smokeContext,
              connectionState.apiBaseURL == context.apiBaseURL.absoluteString,
              ownedRead else {
            connectionState.connectionStatus = .error(
                runtimeState.localRuntime.state.failureMessage ?? "Isolated smoke has no verified owned API."
            )
            alertsState.disconnectStream(alertStream)
            return false
        }
        return true
    }

    func refreshConnection(userInitiated: Bool = false) async {
        guard launchMode.allowsInitialLaunchSideEffects, permitsSmokeConnectionRead() else { return }
        let authToken = launchPolicy.connectionToken {
            connectionState.loadConnectionSecretsIfNeeded(allowUserInteraction: userInitiated)
            return connectionState.resolvedConnectionAuthToken(allowUserInteraction: userInitiated)
        }
        await apiClient.updateAuthToken(authToken)
        guard permitsSmokeConnectionRead() else { return }

        connectionState.connectionStatus = .connecting
        let connectionResult = await apiClient.testConnection()
        guard permitsSmokeConnectionRead() else { return }

        switch connectionResult {
        case .success:
            connectionState.connectionStatus = .connected
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
            connectionState.connectionStatus = .error(AppErrorPresentation.message(for: error))
            alertsState.disconnectStream(alertStream)
        }
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

    func handleStreamAlert(_ alert: Alert) {
        alertsState.handleStreamAlert(alert)
    }

    func refreshUnreadCount() async {
        guard launchMode.allowsInitialLaunchSideEffects, permitsSmokeConnectionRead() else { return }
        await alertsState.refreshUnreadCount(using: apiClient)
        guard permitsSmokeConnectionRead() else { return }
    }

    // MARK: - Internal Helpers

    private func startManagedLocalRuntime(
        bootMode: LocalRuntimeService.BootMode,
        restartExistingRuntime: Bool,
        userInitiated: Bool
    ) async -> Bool {
        if let managedRuntimeTransitionTask {
            let activeResult = await managedRuntimeTransitionTask.value
            if !restartExistingRuntime {
                return activeResult
            }
        }

        let transitionID = UUID()
        let task = Task { @MainActor [weak self] () -> Bool in
            guard let self else { return false }
            defer {
                if self.managedRuntimeTransitionID == transitionID {
                    self.managedRuntimeTransitionTask = nil
                    self.managedRuntimeTransitionID = nil
                }
            }

            return await self.performManagedLocalRuntimeTransition(
                bootMode: bootMode,
                restartExistingRuntime: restartExistingRuntime,
                userInitiated: userInitiated
            )
        }

        managedRuntimeTransitionID = transitionID
        managedRuntimeTransitionTask = task
        return await task.value
    }

    private func performManagedLocalRuntimeTransition(
        bootMode: LocalRuntimeService.BootMode,
        restartExistingRuntime: Bool,
        userInitiated: Bool
    ) async -> Bool {
        stopBackgroundRefreshTasks()
        defer { startBackgroundRefreshTasksIfNeeded() }

        guard usesManagedLocalRuntime else {
            if isIsolatedSmokeLaunch {
                _ = permitsSmokeConnectionRead()
                runtimeState.bundledLaunchExperienceState = .needsAttention("Isolated smoke requires a verified owned local runtime.")
                return false
            }
            runtimeState.bundledLaunchExperienceState = .ready
            await refreshConnection(userInitiated: userInitiated)
            return true
        }

        runtimeState.bundledLaunchExperienceState = .starting

        let startPolicy: LocalRuntimeService.StartPolicy = restartExistingRuntime ? .forceRestart : .ifNeeded
        await runtimeState.localRuntime.start(
            apiBaseURL: connectionState.apiBaseURL,
            bootMode: bootMode,
            policy: startPolicy
        )
        if isIsolatedSmokeLaunch {
            guard runtimeState.localRuntime.state == .running, permitsSmokeConnectionRead() else {
                runtimeState.bundledLaunchExperienceState = .needsAttention(
                    runtimeState.localRuntime.state.failureMessage ?? "Isolated smoke startup has no verified owned API."
                )
                return false
            }
        }
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

        if bootMode == .active {
            runtimeState.hasEnabledMonitoring = true
            runtimeState.hasDismissedInitialMonitoringPrompt = true
            runtimeState.bundledLaunchExperienceState = .ready
        } else if runtimeState.hasDismissedInitialMonitoringPrompt {
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
