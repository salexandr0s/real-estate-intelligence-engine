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

    private static var isSmokeTest: Bool {
        ProcessInfo.processInfo.environment["IMMORADAR_SMOKE_TEST"] == "1"
    }

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
        launchMode.allowsInitialLaunchSideEffects
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
        copilotSettingsState.activeAPIKey()
    }

    // MARK: - Init

    init(launchMode: AppLaunchMode = .current) {
        self.launchMode = launchMode

        let navigationState = NavigationState()
        let connectionState = ConnectionState()
        let runtimeState = RuntimeState(isSmokeTest: Self.isSmokeTest)
        let alertsState = AlertsState()
        let copilotSettingsState = CopilotSettingsState()

        self.navigationState = navigationState
        self.connectionState = connectionState
        self.runtimeState = runtimeState
        self.alertsState = alertsState
        self.copilotSettingsState = copilotSettingsState

        let initialAuthToken: String? = if launchMode == .production {
            ConnectionState.initialStoredAuthToken(isSmokeTest: Self.isSmokeTest)
        } else {
            nil
        }

        self.apiClient = APIClient(
            baseURL: connectionState.apiBaseURL,
            authToken: initialAuthToken
        )

        connectionState.onRefreshIntervalChange = { [weak self] in
            self?.startBackgroundRefreshTasksIfNeeded()
        }

        if launchMode.shouldRequestNotificationPermission,
           !Self.isSmokeTest,
           alertsState.notificationsEnabled {
            NotificationManager.shared.requestPermission()
        }

        if launchMode == .production, !Self.isSmokeTest {
            runSilentStaleSecretsCleanupIfNeeded()
        }
    }

    // MARK: - Settings

    func loadSettingsSecretsIfNeeded() {
        connectionState.loadConnectionSecretsIfNeeded(allowUserInteraction: true)
        copilotSettingsState.loadCopilotSecretsIfNeeded(allowUserInteraction: true)
    }

    func loadConnectionSecretForUserAction() {
        connectionState.loadConnectionSecretForUserAction()
    }

    func loadClaudeSubscriptionIfNeeded() {
        copilotSettingsState.loadClaudeSubscriptionIfNeeded()
    }

    func refreshClaudeSubscription() {
        copilotSettingsState.refreshClaudeSubscription()
    }

    func clearSettingsError() {
        connectionState.clearSettingsError()
        runtimeState.clearSettingsError()
        copilotSettingsState.clearSettingsError()
    }

    func testConnection(baseURL: String, token: String) async {
        await connectionState.testConnection(baseURL: baseURL, token: token)
    }

    func applyConnectionSettings(baseURL: String, token: String) async {
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
        _ = await copilotSettingsState.applySettings(
            provider: provider,
            anthropicKey: anthropicKey,
            openAIKey: openAIKey,
            model: model
        )
    }

    func cleanupStoredSecrets() {
        connectionState.cleanupStoredSecrets()
        copilotSettingsState.cleanupStoredSecrets()
    }

    func resolvedConnectionAuthToken(allowUserInteraction: Bool = true) -> String? {
        connectionState.resolvedConnectionAuthToken(allowUserInteraction: allowUserInteraction)
    }

    // MARK: - Background Refresh

    func startBackgroundRefreshTasksIfNeeded() {
        let allowsBackgroundRefreshTasks = launchMode.allowsBackgroundRefreshTasks

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
            await runtimeState.localRuntime.refreshStatus(apiBaseURL: connectionState.apiBaseURL)
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
            restartExistingRuntime: true,
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
            try await runtimeState.localRuntime.resetLocalEngine()
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

    func prepareForTermination() async {
        stopBackgroundRefreshTasks()
        alertsState.disconnectStream(alertStream)
    }

    // MARK: - Connection / Alerts

    func refreshConnection(userInitiated: Bool = false) async {
        connectionState.loadConnectionSecretsIfNeeded(allowUserInteraction: userInitiated)
        let authToken = connectionState.resolvedConnectionAuthToken(allowUserInteraction: userInitiated)
        await apiClient.updateAuthToken(authToken)

        connectionState.connectionStatus = .connecting
        let connectionResult = await apiClient.testConnection()

        switch connectionResult {
        case .success:
            connectionState.connectionStatus = .connected
            await alertsState.refreshUnreadCount(using: apiClient)
            alertsState.connectStreamIfNeeded(
                alertStream,
                baseURL: connectionState.apiBaseURL,
                token: authToken
            )
        case .failure(let error):
            connectionState.connectionStatus = .error(AppErrorPresentation.message(for: error))
            alertsState.disconnectStream(alertStream)
        }
    }

    func handleStreamAlert(_ alert: Alert) {
        alertsState.handleStreamAlert(alert)
    }

    func refreshUnreadCount() async {
        await alertsState.refreshUnreadCount(using: apiClient)
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
        case .running:
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
