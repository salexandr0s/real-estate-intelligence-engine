import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var showSettingsError = false
    @State private var didLoadDraft = false
    @State private var cleanupStatusMessage: String?
    @State private var draft = SettingsDraft()

    var body: some View {
        @Bindable var state = appState

        Form {
            SettingsConnectionSection(
                draft: $draft,
                connectionStatus: appState.connectionStatus,
                hasChanges: draft.hasConnectionChanges(comparedTo: appState),
                onApply: applyConnectionSettings,
                onTest: testConnectionSettings
            )

            SettingsAISection(
                draft: $draft,
                appState: appState,
                hasChanges: draft.hasAIChanges(comparedTo: appState),
                onApply: applyAISettings
            )

            Section("Refresh") {
                Stepper(
                    "Interval: \(appState.refreshIntervalSeconds)s",
                    value: $state.refreshIntervalSeconds,
                    in: 10...3600,
                    step: 10
                )
            }

            Section("Notifications") {
                Toggle("Enable Notifications", isOn: $state.notificationsEnabled)
                if appState.notificationsEnabled {
                    Toggle("New Matches", isOn: $state.notifyOnNewMatch)
                    Toggle("Price Drops", isOn: $state.notifyOnPriceDrop)
                    Toggle("Score Changes", isOn: $state.notifyOnScoreChange)
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
                openAIKey: draft.openaiApiKey,
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
    var openaiApiKey = ""
    var copilotModel = ""

    @MainActor static func from(_ appState: AppState) -> Self {
        Self(
            apiBaseURL: appState.apiBaseURL,
            apiToken: appState.apiToken,
            copilotProvider: appState.copilotProvider,
            anthropicApiKey: appState.anthropicApiKey,
            openaiApiKey: appState.openaiApiKey,
            copilotModel: appState.copilotModel
        )
    }

    @MainActor func hasConnectionChanges(comparedTo appState: AppState) -> Bool {
        apiBaseURL != appState.apiBaseURL || apiToken != appState.apiToken
    }

    @MainActor func hasAIChanges(comparedTo appState: AppState) -> Bool {
        copilotProvider != appState.copilotProvider
            || anthropicApiKey != appState.anthropicApiKey
            || openaiApiKey != appState.openaiApiKey
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

private struct SettingsConnectionSection: View {
    @Binding var draft: SettingsDraft
    let connectionStatus: ConnectionStatus
    let hasChanges: Bool
    let onApply: () -> Void
    let onTest: () -> Void

    var body: some View {
        Section("API Connection") {
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
            SecureField("OpenAI API Key", text: $draft.openaiApiKey)
                .textFieldStyle(.roundedBorder)
            if draft.openaiApiKey.isEmpty {
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
