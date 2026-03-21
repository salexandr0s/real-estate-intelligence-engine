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
