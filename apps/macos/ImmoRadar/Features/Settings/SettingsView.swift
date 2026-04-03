import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var showSettingsError = false
    @State private var didLoadDraft = false
    @State private var cleanupStatusMessage: String?
    @State private var showAdvancedConnectionSettings = false
    @State private var draft = SettingsDraft()

    var body: some View {
        @Bindable var connectionState = appState.connectionState
        @Bindable var alertsState = appState.alertsState

        Form {
            if appState.usesManagedLocalRuntime {
                SettingsLocalEngineSection(showAdvancedConnectionSettings: $showAdvancedConnectionSettings)

                if showAdvancedConnectionSettings {
                    SettingsConnectionSection(
                        title: "Advanced Connection Settings",
                        draft: $draft,
                        connectionStatus: appState.connectionStatus,
                        hasChanges: draft.hasConnectionChanges(comparedTo: appState),
                        onApply: applyConnectionSettings,
                        onTest: testConnectionSettings
                    )
                }
            } else {
                SettingsConnectionSection(
                    title: "API Connection",
                    draft: $draft,
                    connectionStatus: appState.connectionStatus,
                    hasChanges: draft.hasConnectionChanges(comparedTo: appState),
                    onApply: applyConnectionSettings,
                    onTest: testConnectionSettings
                )
            }

            SettingsAISection(
                draft: $draft,
                appState: appState,
                hasChanges: draft.hasAIChanges(comparedTo: appState),
                onApply: applyAISettings
            )

            Section("Refresh") {
                Stepper(
                    "Interval: \(connectionState.refreshIntervalSeconds)s",
                    value: $connectionState.refreshIntervalSeconds,
                    in: 10...3600,
                    step: 10
                )
            }

            Section("Notifications") {
                Toggle("Enable Notifications", isOn: $alertsState.notificationsEnabled)
                if alertsState.notificationsEnabled {
                    Toggle("New Matches", isOn: $alertsState.notifyOnNewMatch)
                    Toggle("Price Drops", isOn: $alertsState.notifyOnPriceDrop)
                    Toggle("Score Changes", isOn: $alertsState.notifyOnScoreChange)
                }
            }

            SettingsStoredSecretsSection(
                cleanupStatusMessage: cleanupStatusMessage,
                onCleanup: handleCleanupSecrets
            )
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .task {
            guard appState.allowsAutomaticFeatureLoads else { return }
            loadDraftIfNeeded()
        }
        .onChange(of: draft.copilotProvider) { _, newValue in
            guard newValue == .claudeSubscription else { return }
            appState.loadClaudeSubscriptionIfNeeded()
        }
        .onChange(of: appState.settingsErrorMessage) { _, newValue in
            showSettingsError = newValue != nil
        }
        .alert("Settings Update Failed", isPresented: $showSettingsError) {
            Button("OK", role: .cancel) {
                appState.clearSettingsError()
            }
        } message: {
            if let message = appState.settingsErrorMessage {
                Text(message)
            }
        }
    }

    private func loadDraftIfNeeded() {
        guard !didLoadDraft else { return }
        appState.loadSettingsSecretsIfNeeded()
        syncDraftFromAppState()
        if draft.copilotProvider == .claudeSubscription {
            appState.loadClaudeSubscriptionIfNeeded()
        }
        didLoadDraft = true
    }

    private func syncDraftFromAppState() {
        draft = .from(appState)
    }

    private func handleCleanupSecrets() {
        appState.cleanupStoredSecrets()
        syncDraftFromAppState()
        cleanupStatusMessage = "Stored secrets checked and stale empty entries removed."
    }

    private func applyConnectionSettings() {
        Task {
            await appState.applyConnectionSettings(
                baseURL: draft.apiBaseURL,
                token: draft.apiToken
            )
            if appState.settingsErrorMessage == nil {
                syncDraftFromAppState()
            }
        }
    }

    private func testConnectionSettings() {
        Task {
            await appState.testConnection(
                baseURL: draft.apiBaseURL,
                token: draft.apiToken
            )
        }
    }

    private func applyAISettings() {
        Task {
            await appState.applyCopilotSettings(
                provider: draft.copilotProvider,
                anthropicKey: draft.anthropicApiKey,
                openAIKey: draft.openaiKey,
                model: draft.copilotModel
            )
            if appState.settingsErrorMessage == nil {
                syncDraftFromAppState()
            }
        }
    }
}

private struct SettingsDraft: Equatable {
    var apiBaseURL = ""
    var apiToken = ""
    var copilotProvider: CopilotProvider = .anthropic
    var anthropicApiKey = ""
    var openaiKey = ""
    var copilotModel = ""

    @MainActor static func from(_ appState: AppState) -> Self {
        Self(
            apiBaseURL: appState.apiBaseURL,
            apiToken: appState.apiToken,
            copilotProvider: appState.copilotProvider,
            anthropicApiKey: appState.anthropicApiKey,
            openaiKey: appState.openaiApiKey,
            copilotModel: appState.copilotModel
        )
    }

    @MainActor func hasConnectionChanges(comparedTo appState: AppState) -> Bool {
        apiBaseURL != appState.apiBaseURL || apiToken != appState.apiToken
    }

    @MainActor func hasAIChanges(comparedTo appState: AppState) -> Bool {
        copilotProvider != appState.copilotProvider
            || anthropicApiKey != appState.anthropicApiKey
            || openaiKey != appState.openaiApiKey
            || copilotModel != appState.copilotModel
    }

    var defaultModelDescription: String {
        switch copilotProvider {
        case .openai:
            "gpt-4o"
        case .anthropic, .claudeSubscription:
            "claude-sonnet-4"
        }
    }
}

private struct SettingsLocalEngineSection: View {
    @Environment(AppState.self) private var appState
    @Binding var showAdvancedConnectionSettings: Bool

    var body: some View {
        let diagnostics = appState.localRuntimeDiagnostics

        Section("Local Engine") {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Label(statusTitle, systemImage: statusIcon)
                    .font(.headline)
                    .foregroundStyle(statusTint)

                Text(statusSubtitle)
                    .font(.callout)
                    .foregroundStyle(.secondary)

                HStack(spacing: Theme.Spacing.sm) {
                    Label(diagnostics.runtimeDescription, systemImage: "externaldrive.fill")
                    if let version = diagnostics.runtimeVersion {
                        Text(version)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if let message = diagnostics.lastErrorMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }

            HStack(spacing: Theme.Spacing.sm) {
                if appState.hasEnabledMonitoring {
                    Button("Pause Monitoring") {
                        Task { await appState.pauseMonitoring() }
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button("Start Monitoring") {
                        Task { await appState.startMonitoring() }
                    }
                    .buttonStyle(.borderedProminent)
                }

                Button("Restart Engine") {
                    Task { await appState.restartLocalEngine() }
                }
                .buttonStyle(.bordered)
            }

            HStack(spacing: Theme.Spacing.sm) {
                Button("Reveal Logs") {
                    appState.openLocalEngineLogs()
                }
                .buttonStyle(.bordered)

                Button("Reveal Data Folder") {
                    appState.openLocalEngineDataFolder()
                }
                .buttonStyle(.bordered)

                Button("Reset Local Engine", role: .destructive) {
                    Task { await appState.resetLocalEngine() }
                }
                .buttonStyle(.bordered)
            }

            Toggle("Show advanced connection settings", isOn: $showAdvancedConnectionSettings)
                .toggleStyle(.switch)

            Text("Most people can leave advanced connection settings alone. They are only needed if you want this app to talk to a different ImmoRadar server.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var statusTitle: String {
        switch appState.localEngineExperienceState {
        case .starting:
            return "Local engine is starting"
        case .ready:
            return "Local engine is ready"
        case .monitoringPaused:
            return "Monitoring is paused"
        case .monitoringActive:
            return "Monitoring is active"
        case .needsAttention:
            return "Local engine needs attention"
        case .externalConnection:
            return "External ImmoRadar connection"
        }
    }

    private var statusSubtitle: String {
        switch appState.localEngineExperienceState {
        case .starting:
            return "ImmoRadar is preparing the local database, API, and workers on this Mac."
        case .ready:
            return "The local engine is healthy and waiting for you to decide whether automatic monitoring should begin."
        case .monitoringPaused:
            return "Automatic discovery is paused, but the local engine is still available for browsing existing data."
        case .monitoringActive:
            return "Automatic monitoring is enabled and the bundled local engine is running in the background while the app is open."
        case .needsAttention:
            return "Review the diagnostics below, then retry or reset the local engine if needed."
        case .externalConnection:
            return "This app is currently talking to an external ImmoRadar API instead of the built-in local engine."
        }
    }

    private var statusIcon: String {
        switch appState.localEngineExperienceState {
        case .starting:
            return "arrow.triangle.2.circlepath.circle.fill"
        case .ready:
            return "checkmark.circle.fill"
        case .monitoringPaused:
            return "pause.circle.fill"
        case .monitoringActive:
            return "bolt.circle.fill"
        case .needsAttention:
            return "exclamationmark.triangle.fill"
        case .externalConnection:
            return "network"
        }
    }

    private var statusTint: Color {
        switch appState.localEngineExperienceState {
        case .starting:
            return .accentColor
        case .ready, .monitoringActive:
            return .scoreGood
        case .monitoringPaused, .externalConnection:
            return .secondary
        case .needsAttention:
            return .scoreAverage
        }
    }
}

private struct SettingsConnectionSection: View {
    let title: String
    @Binding var draft: SettingsDraft
    let connectionStatus: ConnectionStatus
    let hasChanges: Bool
    let onApply: () -> Void
    let onTest: () -> Void

    var body: some View {
        Section(title) {
            TextField("Base URL", text: $draft.apiBaseURL)
                .textFieldStyle(.roundedBorder)

            SecureField("Bearer Token", text: $draft.apiToken)
                .textFieldStyle(.roundedBorder)

            HStack {
                Circle()
                    .fill(connectionStatus.color)
                    .frame(width: 8, height: 8)
                Text(connectionStatus.displayName)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Apply", action: onApply)
                    .buttonStyle(.borderedProminent)
                    .disabled(!hasChanges)
                Button("Test Connection", action: onTest)
                    .buttonStyle(.bordered)
            }

            Text("Use these settings only if you intentionally want the app to connect to another ImmoRadar server.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct SettingsAISection: View {
    @Binding var draft: SettingsDraft
    let appState: AppState
    let hasChanges: Bool
    let onApply: () -> Void

    var body: some View {
        Section("AI Provider") {
            Picker("Provider", selection: $draft.copilotProvider) {
                ForEach(CopilotProvider.allCases) { provider in
                    Text(provider.displayName)
                        .tag(provider)
                }
            }
            .pickerStyle(.radioGroup)

            providerCredentials
            providerStatus

            TextField("Model override (optional)", text: $draft.copilotModel)
                .textFieldStyle(.roundedBorder)
            Text("Leave empty for default (\(draft.defaultModelDescription))")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                Spacer()
                Button("Apply AI Settings", action: onApply)
                    .buttonStyle(.borderedProminent)
                    .disabled(!hasChanges)
            }
        }
    }

    @ViewBuilder
    private var providerCredentials: some View {
        if draft.copilotProvider == .anthropic {
            SecureField("Anthropic API Key", text: $draft.anthropicApiKey)
                .textFieldStyle(.roundedBorder)
            if draft.anthropicApiKey.isEmpty {
                Label("Get your API key from console.anthropic.com", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }

        if draft.copilotProvider == .openai {
            SecureField("OpenAI API Key", text: $draft.openaiKey)
                .textFieldStyle(.roundedBorder)
            if draft.openaiKey.isEmpty {
                Label("Get your API key from platform.openai.com", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var providerStatus: some View {
        if draft.copilotProvider == .claudeSubscription {
            if appState.claudeSubscriptionAvailable {
                subscriptionStatusRow(
                    title: "Claude subscription detected",
                    subtitle: appState.claudeSubscriptionType.map { "Plan: \($0.capitalized)" },
                    systemImage: "checkmark.circle.fill",
                    tint: .green
                )
            } else {
                subscriptionStatusRow(
                    title: "No Claude subscription found",
                    subtitle: "Run 'claude login' in Terminal to authenticate",
                    systemImage: "exclamationmark.triangle.fill",
                    tint: .yellow
                )
            }
        }
    }

    private func subscriptionStatusRow(
        title: String,
        subtitle: String?,
        systemImage: String,
        tint: Color
    ) -> some View {
        HStack {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.callout)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button("Refresh") {
                appState.refreshClaudeSubscription()
            }
            .controlSize(.small)
        }
    }
}

private struct SettingsStoredSecretsSection: View {
    let cleanupStatusMessage: String?
    let onCleanup: () -> Void

    var body: some View {
        Section("Stored Secrets") {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Clean stale credentials")
                    Text("Removes empty keychain entries left by older builds.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Clean Up", action: onCleanup)
                    .buttonStyle(.bordered)
            }

            if let cleanupStatusMessage {
                Text(cleanupStatusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
