import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var showSettingsError: Bool = false
    @State private var didLoadDrafts = false
    @State private var cleanupStatusMessage: String?

    @State private var apiBaseURLDraft = ""
    @State private var apiTokenDraft = ""
    @State private var copilotProviderDraft: CopilotProvider = .anthropic
    @State private var anthropicApiKeyDraft = ""
    @State private var openaiApiKeyDraft = ""
    @State private var copilotModelDraft = ""

    private var hasConnectionChanges: Bool {
        apiBaseURLDraft != appState.apiBaseURL || apiTokenDraft != appState.apiToken
    }

    private var hasAIChanges: Bool {
        copilotProviderDraft != appState.copilotProvider
            || anthropicApiKeyDraft != appState.anthropicApiKey
            || openaiApiKeyDraft != appState.openaiApiKey
            || copilotModelDraft != appState.copilotModel
    }

    private var defaultModelDescription: String {
        switch copilotProviderDraft {
        case .openai:
            return "gpt-4o"
        case .anthropic, .claudeSubscription:
            return "claude-sonnet-4"
        }
    }

    var body: some View {
        @Bindable var state = appState

        Form {
            Section("API Connection") {
                TextField("Base URL", text: $apiBaseURLDraft)
                    .textFieldStyle(.roundedBorder)

                SecureField("Bearer Token", text: $apiTokenDraft)
                    .textFieldStyle(.roundedBorder)

                HStack {
                    Circle()
                        .fill(appState.connectionStatus.color)
                        .frame(width: 8, height: 8)
                    Text(appState.connectionStatus.displayName)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Apply", action: applyConnectionSettings)
                        .buttonStyle(.borderedProminent)
                        .disabled(!hasConnectionChanges)
                    Button("Test Connection", action: testConnectionSettings)
                        .buttonStyle(.bordered)
                }
            }

            Section("AI Provider") {
                Picker("Provider", selection: $copilotProviderDraft) {
                    ForEach(CopilotProvider.allCases) { provider in
                        Text(provider.displayName)
                            .tag(provider)
                    }
                }
                .pickerStyle(.radioGroup)

                if copilotProviderDraft == .anthropic {
                    SecureField("Anthropic API Key", text: $anthropicApiKeyDraft)
                        .textFieldStyle(.roundedBorder)
                    if anthropicApiKeyDraft.isEmpty {
                        Label("Get your API key from console.anthropic.com", systemImage: "info.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if copilotProviderDraft == .openai {
                    SecureField("OpenAI API Key", text: $openaiApiKeyDraft)
                        .textFieldStyle(.roundedBorder)
                    if openaiApiKeyDraft.isEmpty {
                        Label("Get your API key from platform.openai.com", systemImage: "info.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if copilotProviderDraft == .claudeSubscription {
                    if appState.claudeSubscriptionAvailable {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Claude subscription detected")
                                    .font(.callout)
                                if let subType = appState.claudeSubscriptionType {
                                    Text("Plan: \(subType.capitalized)")
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
                    } else {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.yellow)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("No Claude subscription found")
                                    .font(.callout)
                                Text("Run 'claude login' in Terminal to authenticate")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Refresh") {
                                appState.refreshClaudeSubscription()
                            }
                            .controlSize(.small)
                        }
                    }
                }

                TextField("Model override (optional)", text: $copilotModelDraft)
                    .textFieldStyle(.roundedBorder)
                Text("Leave empty for default (\(defaultModelDescription))")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack {
                    Spacer()
                    Button("Apply AI Settings", action: applyAISettings)
                        .buttonStyle(.borderedProminent)
                        .disabled(!hasAIChanges)
                }
            }

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

            Section("Stored Secrets") {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Clean stale credentials")
                        Text("Removes empty keychain entries left by older builds.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Clean Up") {
                        appState.cleanupStoredSecrets()
                        syncDraftsFromAppState()
                        cleanupStatusMessage = "Stored secrets checked and stale empty entries removed."
                    }
                    .buttonStyle(.bordered)
                }

                if let cleanupStatusMessage {
                    Text(cleanupStatusMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .onAppear {
            loadDraftsIfNeeded()
        }
        .onChange(of: copilotProviderDraft) { _, newValue in
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

    private func loadDraftsIfNeeded() {
        guard !didLoadDrafts else { return }
        appState.loadSettingsSecretsIfNeeded()
        syncDraftsFromAppState()
        if copilotProviderDraft == .claudeSubscription {
            appState.loadClaudeSubscriptionIfNeeded()
        }
        didLoadDrafts = true
    }

    private func syncDraftsFromAppState() {
        apiBaseURLDraft = appState.apiBaseURL
        apiTokenDraft = appState.apiToken
        copilotProviderDraft = appState.copilotProvider
        anthropicApiKeyDraft = appState.anthropicApiKey
        openaiApiKeyDraft = appState.openaiApiKey
        copilotModelDraft = appState.copilotModel
    }

    private func applyConnectionSettings() {
        Task {
            await appState.applyConnectionSettings(
                baseURL: apiBaseURLDraft,
                token: apiTokenDraft
            )
            if appState.settingsErrorMessage == nil {
                syncDraftsFromAppState()
            }
        }
    }

    private func testConnectionSettings() {
        Task {
            await appState.testConnection(
                baseURL: apiBaseURLDraft,
                token: apiTokenDraft
            )
        }
    }

    private func applyAISettings() {
        Task {
            await appState.applyCopilotSettings(
                provider: copilotProviderDraft,
                anthropicKey: anthropicApiKeyDraft,
                openAIKey: openaiApiKeyDraft,
                model: copilotModelDraft
            )
            if appState.settingsErrorMessage == nil {
                syncDraftsFromAppState()
            }
        }
    }
}
