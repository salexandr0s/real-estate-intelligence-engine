import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        Form {
            Section("API Connection") {
                TextField("Base URL", text: $state.apiBaseURL)
                    .textFieldStyle(.roundedBorder)

                SecureField("Bearer Token", text: $state.apiToken)
                    .textFieldStyle(.roundedBorder)

                HStack {
                    Circle()
                        .fill(appState.connectionStatus.color)
                        .frame(width: 8, height: 8)
                    Text(appState.connectionStatus.displayName)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Test Connection") {
                        Task {
                            await appState.apiClient.updateBaseURL(appState.apiBaseURL)
                            await appState.apiClient.updateAuthToken(
                                appState.apiToken.isEmpty ? nil : appState.apiToken
                            )
                            await appState.refreshConnection()
                        }
                    }
                }
            }

            Section("AI Provider") {
                Picker("Provider", selection: $state.copilotProvider) {
                    ForEach(CopilotProvider.allCases) { provider in
                        Text(provider.displayName)
                            .tag(provider)
                    }
                }
                .pickerStyle(.radioGroup)

                if appState.copilotProvider == .anthropic {
                    SecureField("Anthropic API Key", text: $state.anthropicApiKey)
                        .textFieldStyle(.roundedBorder)
                    if appState.anthropicApiKey.isEmpty {
                        Label("Get your API key from console.anthropic.com", systemImage: "info.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if appState.copilotProvider == .openai {
                    SecureField("OpenAI API Key", text: $state.openaiApiKey)
                        .textFieldStyle(.roundedBorder)
                    if appState.openaiApiKey.isEmpty {
                        Label("Get your API key from platform.openai.com", systemImage: "info.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if appState.copilotProvider == .claudeSubscription {
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

                // Optional model override
                TextField("Model override (optional)", text: $state.copilotModel)
                    .textFieldStyle(.roundedBorder)
                Text("Leave empty for default (\(appState.copilotProvider == .openai ? "gpt-4o" : "claude-sonnet-4"))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
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
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
    }
}
