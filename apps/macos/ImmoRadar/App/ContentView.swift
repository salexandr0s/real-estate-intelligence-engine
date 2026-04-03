import SwiftUI

/// Root view with NavigationSplitView sidebar and detail content.
struct ContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if appState.shouldPresentBundledLaunchExperience {
                BundledLaunchExperienceView()
            } else {
                mainShell
            }
        }
        .frame(minWidth: 1100, minHeight: 600)
        .onChange(of: appState.alertStream.lastEvent?.id) { _, _ in
            if let alert = appState.alertStream.lastEvent {
                appState.handleStreamAlert(alert)
            }
        }
    }

    private var mainShell: some View {
        VStack(spacing: 0) {
            if appState.shouldShowMonitoringPausedBanner {
                MonitoringPausedBanner()
            }

            if let message = appState.globalConnectionWarningMessage {
                InlineWarningBanner(
                    title: appState.usesManagedLocalRuntime
                        ? "Local API unavailable"
                        : AppErrorPresentation.apiConnectionTitle,
                    message: message,
                    actions: connectionWarningActions
                )
                .padding(.horizontal, Theme.Spacing.xl)
                .padding(.top, Theme.Spacing.sm)
            }

            NavigationSplitView {
                SidebarView()
            } detail: {
                DetailContentView()
            }
            .navigationSplitViewStyle(.balanced)
        }
    }

    private var connectionWarningActions: [InlineWarningBanner.Action] {
        var actions: [InlineWarningBanner.Action] = []

        if appState.usesManagedLocalRuntime {
            actions.append(
                InlineWarningBanner.Action("Open Sources") {
                    appState.navigateTo(.sources)
                }
            )
        }

        actions.append(
            InlineWarningBanner.Action(
                "Retry",
                systemImage: "arrow.clockwise",
                isProminent: true
            ) {
                Task {
                    if appState.usesManagedLocalRuntime {
                        await appState.restartLocalEngine()
                    } else {
                        await appState.refreshConnection(userInitiated: true)
                    }
                }
            }
        )

        return actions
    }
}

private struct BundledLaunchExperienceView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        let diagnostics = appState.localRuntimeDiagnostics

        ZStack {
            Color(nsColor: .windowBackgroundColor)
                .ignoresSafeArea()

            VStack(spacing: Theme.Spacing.xl) {
                Spacer(minLength: Theme.Spacing.xxxl)

                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    header

                    switch appState.bundledLaunchExperienceState {
                    case .checking, .starting:
                        startingContent
                    case .readyToStartMonitoring:
                        readyContent
                    case .needsAttention(let message):
                        failureContent(message: message, diagnostics: diagnostics)
                    case .ready:
                        EmptyView()
                    }
                }
                .frame(maxWidth: 720, alignment: .leading)
                .padding(Theme.Spacing.xxl)
                .cardStyle(.subtle, padding: 0, cornerRadius: Theme.Radius.xl)

                Spacer()
            }
            .padding(Theme.Spacing.xl)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.lg) {
            ZStack {
                Circle()
                    .fill(headerTint.opacity(0.12))
                    .frame(width: 56, height: 56)
                Image(systemName: headerIcon)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(headerTint)
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Text("ImmoRadar")
                    .font(.title2.weight(.semibold))
                Text(headerTitle)
                    .font(.title3.weight(.semibold))
                Text(headerSubtitle)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var startingContent: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            if let progress = appState.localRuntime.progressStatus {
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    HStack(spacing: Theme.Spacing.sm) {
                        if let fraction = progress.fractionCompleted {
                            ProgressView(value: fraction)
                                .frame(width: 220)
                        } else {
                            ProgressView()
                                .controlSize(.small)
                        }

                        Text(progress.title)
                            .font(.callout.weight(.semibold))
                    }

                    Text(progress.detail)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Text("Everything stays on this Mac")
                    .font(.callout.weight(.semibold))
                Text("ImmoRadar is starting its local database, API, and workers for you. No Terminal or manual setup is required.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            BundledRuntimeComponentRow()

            diagnosticsFooter
        }
    }

    private var readyContent: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Text("ImmoRadar is ready on this Mac.")
                    .font(.title3.weight(.semibold))
                Text("Start monitoring when you want automatic background discovery. You can also wait and explore the app first.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            BundledRuntimeComponentRow()
            diagnosticsFooter

            HStack(spacing: Theme.Spacing.sm) {
                Button {
                    Task { await appState.startMonitoring() }
                } label: {
                    Label("Start Monitoring", systemImage: "play.fill")
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)

                Button("Not Now") {
                    appState.dismissInitialMonitoringPrompt()
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.cancelAction)
            }
        }
    }

    private func failureContent(
        message: String,
        diagnostics: LocalRuntimeService.DiagnosticsSummary
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Text("The local engine needs attention before ImmoRadar can continue.")
                    .font(.title3.weight(.semibold))
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                diagnosticsRow("Runtime", value: diagnostics.runtimeDescription)
                if let version = diagnostics.runtimeVersion {
                    diagnosticsRow("Version", value: version)
                }
                diagnosticsRow("Storage", value: diagnostics.storagePath)
                diagnosticsRow("Logs", value: diagnostics.logsPath)
                diagnosticsRow("Diagnostics", value: diagnostics.startupDiagnosticsPath)
            }
            .padding(Theme.Spacing.md)
            .background(Color(nsColor: .controlBackgroundColor).opacity(0.55), in: RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))

            HStack(spacing: Theme.Spacing.sm) {
                Button {
                    Task { await appState.retryBundledLaunch() }
                } label: {
                    Label("Retry", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)

                Button("Open Diagnostics") {
                    appState.openLocalEngineDiagnostics()
                }
                .buttonStyle(.bordered)

                Button("Reveal Logs") {
                    appState.openLocalEngineLogs()
                }
                .buttonStyle(.bordered)

                Button("Reset Local Engine", role: .destructive) {
                    Task { await appState.resetLocalEngine() }
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private func diagnosticsRow(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.monospaced())
                .textSelection(.enabled)
        }
    }

    private var diagnosticsFooter: some View {
        let diagnostics = appState.localRuntimeDiagnostics

        return VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Divider()
            HStack(spacing: Theme.Spacing.md) {
                Label(diagnostics.runtimeDescription, systemImage: "externaldrive.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let version = diagnostics.runtimeVersion {
                    Text(version)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            HStack(spacing: Theme.Spacing.sm) {
                Button("Reveal Logs") {
                    appState.openLocalEngineLogs()
                }
                .buttonStyle(.borderless)

                Button("Reveal Data Folder") {
                    appState.openLocalEngineDataFolder()
                }
                .buttonStyle(.borderless)
            }
            .font(.caption.weight(.medium))
        }
    }

    private var headerIcon: String {
        switch appState.bundledLaunchExperienceState {
        case .checking, .starting:
            return "bolt.circle.fill"
        case .readyToStartMonitoring:
            return "checkmark.circle.fill"
        case .ready:
            return "checkmark.circle.fill"
        case .needsAttention:
            return "exclamationmark.triangle.fill"
        }
    }

    private var headerTint: Color {
        switch appState.bundledLaunchExperienceState {
        case .checking, .starting:
            return .accentColor
        case .readyToStartMonitoring, .ready:
            return .scoreGood
        case .needsAttention:
            return .scoreAverage
        }
    }

    private var headerTitle: String {
        switch appState.bundledLaunchExperienceState {
        case .checking, .starting:
            return "Starting your local engine"
        case .readyToStartMonitoring:
            return "Your app is ready"
        case .ready:
            return "Your app is ready"
        case .needsAttention:
            return "We hit a startup problem"
        }
    }

    private var headerSubtitle: String {
        switch appState.bundledLaunchExperienceState {
        case .checking, .starting:
            return "ImmoRadar is setting up the bundled local runtime so it can run entirely on this Mac."
        case .readyToStartMonitoring:
            return "Automatic monitoring is optional. Turn it on when you want background discovery to begin."
        case .ready:
            return "The bundled local engine is running and ready."
        case .needsAttention:
            return "You can retry the startup, review diagnostics, or reset the local engine and start fresh."
        }
    }
}

private struct BundledRuntimeComponentRow: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        FlowLayout(spacing: Theme.Spacing.xs) {
            ForEach(appState.localRuntime.componentStatuses) { component in
                Label {
                    Text(component.kind.rawValue)
                } icon: {
                    Circle()
                        .fill(component.isRunning ? Color.scoreGood : Color.secondary.opacity(0.45))
                        .frame(width: 8, height: 8)
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(component.isRunning ? .primary : .secondary)
            }
        }
    }
}

private struct MonitoringPausedBanner: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            Label("Monitoring is paused on this Mac", systemImage: "pause.circle.fill")
                .font(.callout.weight(.semibold))
                .foregroundStyle(Color.accentColor)

            Text("You can browse local data now, then turn on monitoring when you want automatic discovery to run in the background.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            Spacer(minLength: Theme.Spacing.lg)

            Button {
                Task { await appState.startMonitoring() }
            } label: {
                Label("Start Monitoring", systemImage: "play.fill")
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(.horizontal, Theme.Spacing.xl)
        .padding(.vertical, Theme.Spacing.md)
        .background(Color.accentColor.opacity(0.08))
        .overlay(alignment: .bottom) {
            Divider()
        }
    }
}

#Preview {
    ContentView()
        .environment(AppState())
}
