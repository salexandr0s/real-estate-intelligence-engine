import AppKit
import SwiftUI

/// Sources monitoring view showing source health and recent operational details.
struct SourcesView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = SourcesViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                if let error = viewModel.errorMessage,
                   !AppErrorPresentation.isConnectionIssue(message: error) {
                    InlineWarningBanner(
                        title: "Couldn’t complete the last sources action.",
                        message: error,
                        actions: [
                            .init("Dismiss") {
                                viewModel.clearError()
                            },
                            .init("Retry", systemImage: "arrow.clockwise", isProminent: true) {
                                Task { await viewModel.refresh(using: appState.apiClient) }
                            },
                        ]
                    )
                }

                SourcesRuntimeCard(viewModel: viewModel)

                SourcesSummaryBar(viewModel: viewModel)

                SourcesLifecycleOpsCard(viewModel: viewModel)

                if viewModel.sources.isEmpty && !viewModel.isLoading {
                    SourcesEmptyState()
                } else {
                    SourcesListContent(viewModel: viewModel)
                }
            }
            .padding(Theme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .navigationTitle("Sources")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .toolbar(id: "sources") {
            ToolbarItem(id: "pauseAll", placement: .automatic) {
                Button {
                    Task { await viewModel.togglePauseAll(using: appState.apiClient) }
                } label: {
                    Label(
                        viewModel.allPaused ? "Resume All" : "Pause All",
                        systemImage: viewModel.allPaused ? "play.fill" : "pause.fill"
                    )
                }
                .disabled(viewModel.sources.isEmpty)
            }
            ToolbarItem(id: "refresh", placement: .automatic) {
                Button {
                    Task { await viewModel.refresh(using: appState.apiClient) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
            }
        }
        .task {
            guard appState.allowsAutomaticFeatureLoads else { return }
            await viewModel.refresh(using: appState.apiClient)
        }
    }
}

private struct SourcesRuntimeCard: View {
    @Environment(AppState.self) private var appState
    let viewModel: SourcesViewModel

    var body: some View {
        let diagnostics = appState.localRuntimeDiagnostics

        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            HStack(alignment: .top, spacing: Theme.Spacing.lg) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Label(statusTitle, systemImage: statusIcon)
                        .font(.headline)
                        .foregroundStyle(statusColor)

                    Text(statusDetail)
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    if let progress = appState.localRuntime.progressStatus {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            HStack(spacing: Theme.Spacing.sm) {
                                if let fraction = progress.fractionCompleted {
                                    ProgressView(value: fraction)
                                        .frame(width: 180)
                                } else {
                                    ProgressView()
                                        .controlSize(.small)
                                }

                                Text(progress.title)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(.primary)
                            }

                            Text(progress.detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.top, Theme.Spacing.xs)
                    }

                    Text(helperCopy)
                        .font(.caption)
                        .foregroundStyle(.tertiary)

                    if appState.usesManagedLocalRuntime {
                        FlowLayout(spacing: Theme.Spacing.xs) {
                            ForEach(appState.localRuntime.componentStatuses) { component in
                                Label {
                                    Text(component.kind.rawValue)
                                } icon: {
                                    Circle()
                                        .fill(component.isRunning ? Color.scoreGood : Color.secondary.opacity(0.5))
                                        .frame(width: 8, height: 8)
                                }
                                .font(.caption.weight(.medium))
                                .foregroundStyle(component.isRunning ? .primary : .secondary)
                            }
                        }
                    }
                }

                Spacer()

                VStack(alignment: .trailing, spacing: Theme.Spacing.sm) {
                    primaryActions
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
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
                    .buttonStyle(.bordered)

                    if appState.usesManagedLocalRuntime {
                        Button("Reveal Data Folder") {
                            appState.openLocalEngineDataFolder()
                        }
                        .buttonStyle(.bordered)

                        Button("Reset Local Engine", role: .destructive) {
                            Task { await appState.resetLocalEngine() }
                        }
                        .buttonStyle(.bordered)
                    }
                }

                if let message = diagnostics.lastErrorMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        }
        .padding(Theme.Spacing.lg)
        .cardStyle(.subtle, padding: 0, cornerRadius: Theme.Radius.lg)
    }

    @ViewBuilder
    private var primaryActions: some View {
        if appState.usesManagedLocalRuntime {
            switch appState.localEngineExperienceState {
            case .starting:
                Button {
                    Task { await appState.restartLocalEngine() }
                } label: {
                    Label("Starting…", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.bordered)
                .disabled(true)

            case .ready, .monitoringPaused:
                Button {
                    Task {
                        await appState.startMonitoring()
                        await viewModel.refresh(using: appState.apiClient)
                    }
                } label: {
                    Label("Start Monitoring", systemImage: "play.fill")
                }
                .buttonStyle(.borderedProminent)

                Button {
                    Task {
                        await appState.restartLocalEngine()
                        await viewModel.refresh(using: appState.apiClient)
                    }
                } label: {
                    Label("Restart Engine", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)

            case .monitoringActive:
                Button {
                    Task {
                        await appState.pauseMonitoring()
                        await viewModel.refresh(using: appState.apiClient)
                    }
                } label: {
                    Label("Pause Monitoring", systemImage: "pause.fill")
                }
                .buttonStyle(.bordered)

                Button {
                    Task {
                        await appState.restartLocalEngine()
                        await viewModel.refresh(using: appState.apiClient)
                    }
                } label: {
                    Label("Restart Engine", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)

            case .needsAttention:
                Button {
                    Task {
                        await appState.retryBundledLaunch()
                        await viewModel.refresh(using: appState.apiClient)
                    }
                } label: {
                    Label("Retry", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderedProminent)

                Button("Open Diagnostics") {
                    appState.openLocalEngineDiagnostics()
                }
                .buttonStyle(.bordered)

            case .externalConnection:
                EmptyView()
            }
        } else {
            Button("Open Settings") {
                appState.navigateTo(.settings)
            }
            .buttonStyle(.bordered)
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
            return "Connected to an external ImmoRadar API"
        }
    }

    private var statusDetail: String {
        switch appState.localEngineExperienceState {
        case .starting:
            return appState.localRuntime.state.detail
        case .ready:
            return "The local runtime is healthy on this Mac and waiting for your decision about automatic monitoring."
        case .monitoringPaused:
            return "The local runtime is running, but automatic discovery is paused until you start monitoring."
        case .monitoringActive:
            return "The local runtime is actively scheduling background discovery while the app stays open."
        case .needsAttention:
            return appState.localRuntime.state.detail
        case .externalConnection:
            return "This Mac app is using another ImmoRadar server instead of its bundled local engine."
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

    private var statusColor: Color {
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

    private var helperCopy: String {
        switch appState.localEngineExperienceState {
        case .starting:
            return "ImmoRadar is handling local startup automatically: database, queue, API, and workers."
        case .ready:
            return "Everything is ready locally. Turn on monitoring when you want background discovery to begin."
        case .monitoringPaused:
            return "Browsing stays available while monitoring is paused. You can turn it on at any time."
        case .monitoringActive:
            return "Automatic monitoring stays active while the ImmoRadar app is open on this Mac."
        case .needsAttention:
            return "Use the diagnostics below if the local engine needs attention."
        case .externalConnection:
            return "Advanced connection mode is intended for people who want this app to talk to another ImmoRadar server."
        }
    }
}

private struct SourcesSummaryBar: View {
    @Environment(AppState.self) private var appState
    let viewModel: SourcesViewModel

    private let columns = [GridItem(.adaptive(minimum: 180, maximum: 260), spacing: Theme.Spacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.md) {
            SourcesSummaryMetric(title: "Active Sources", value: "\(viewModel.activeCount)", detail: appState.hasEnabledMonitoring ? "currently scheduled" : "configured, monitoring paused", icon: "bolt.fill", tint: .accentColor)
            SourcesSummaryMetric(title: "Needs Attention", value: "\(viewModel.attentionCount)", detail: "blocked or degraded", icon: "exclamationmark.triangle.fill", tint: viewModel.attentionCount > 0 ? .scoreAverage : .secondary)
            SourcesSummaryMetric(title: "Healthy", value: "\(viewModel.healthyCount)", detail: "running cleanly", icon: "checkmark.circle.fill", tint: .scoreGood)
            SourcesSummaryMetric(title: "Total Ingested", value: PriceFormatter.formatCompact(viewModel.totalListingsIngested), detail: "all sources combined", icon: "tray.full.fill", tint: .secondary)
        }
    }
}

private struct SourcesSummaryMetric: View {
    let title: String
    let value: String
    let detail: String
    let icon: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Label(title, systemImage: icon)
                .font(.caption.weight(.medium))
                .foregroundStyle(tint)
            Text(value)
                .font(.title3.weight(.semibold))
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle(.subtle, padding: Theme.Spacing.md, cornerRadius: Theme.Radius.lg)
    }
}

private struct SourcesLifecycleOpsCard: View {
    let viewModel: SourcesViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Dead Listing Resolution", systemImage: "waveform.path.ecg.rectangle")
                        .font(.headline)
                    Text("Explicit source detections vs stale fallback across the last 24 hours and 7 days.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                HStack(spacing: Theme.Spacing.sm) {
                    SourcesLifecycleSummaryPill(
                        title: "Explicit 24h",
                        value: "\(viewModel.lifecycleOpsExplicit24hTotal)",
                        tint: .secondary
                    )
                    SourcesLifecycleSummaryPill(
                        title: "Stale 24h",
                        value: "\(viewModel.lifecycleOpsStale24hTotal)",
                        tint: viewModel.lifecycleOpsStale24hTotal > 0 ? .scoreAverage : .secondary
                    )
                }
            }

            if viewModel.sources.isEmpty && !viewModel.isLoading {
                Text("Source lifecycle activity will appear here once sources begin ingesting listings.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else if !viewModel.hasLifecycleOpsActivity {
                Text("No dead-listing lifecycle activity recorded in the last 7 days.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else {
                VStack(spacing: Theme.Spacing.xs) {
                    SourcesLifecycleHeaderRow()

                    ForEach(viewModel.lifecycleOpsRows) { row in
                        SourcesLifecycleDataRow(row: row)
                    }
                }
            }
        }
        .cardStyle(.subtle, padding: Theme.Spacing.lg, cornerRadius: Theme.Radius.lg)
    }
}

private struct SourcesLifecycleSummaryPill: View {
    let title: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(tint)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
    }
}

private struct SourcesLifecycleHeaderRow: View {
    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Text("Source")
                .frame(maxWidth: .infinity, alignment: .leading)
            metricLabel("Exp 24h")
            metricLabel("Exp 7d")
            metricLabel("Stale 24h")
            metricLabel("Stale 7d")
            timeLabel("Last explicit")
            timeLabel("Last stale")
        }
        .font(.caption2.weight(.medium))
        .foregroundStyle(.tertiary)
        .padding(.horizontal, Theme.Spacing.sm)
    }

    private func metricLabel(_ title: String) -> some View {
        Text(title)
            .frame(width: 60, alignment: .trailing)
    }

    private func timeLabel(_ title: String) -> some View {
        Text(title)
            .frame(width: 96, alignment: .trailing)
    }
}

private struct SourcesLifecycleDataRow: View {
    let row: SourcesViewModel.LifecycleOpsRow

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.sourceName)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
                Text(statusCopy)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            metricValue(row.explicitDead24h, tint: .secondary)
            metricValue(row.explicitDead7d, tint: .secondary)
            metricValue(row.staleExpired24h, tint: row.staleExpired24h > 0 ? .scoreAverage : .secondary)
            metricValue(row.staleExpired7d, tint: row.staleExpired7d > 0 ? .scoreAverage : .secondary)
            timestampValue(row.lastExplicitDeadAt)
            timestampValue(row.lastStaleExpiredAt)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.35), in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
    }

    private var statusCopy: String {
        if row.staleExpired7d > row.explicitDead7d {
            return "Fallback expiry dominates"
        }
        if row.explicitDead7d > 0 {
            return "Source lifecycle signals flowing"
        }
        return "Quiet over the last 7 days"
    }

    private func metricValue(_ value: Int, tint: Color) -> some View {
        Text("\(value)")
            .font(.caption.monospacedDigit().weight(.semibold))
            .foregroundStyle(tint)
            .frame(width: 60, alignment: .trailing)
    }

    private func timestampValue(_ date: Date?) -> some View {
        Text(date.map(PriceFormatter.relativeDate) ?? "—")
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
            .frame(width: 96, alignment: .trailing)
    }
}

private struct SourcesEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label("No Sources", systemImage: "globe")
        } description: {
            Text("Scraping sources will appear here once configured.")
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .cardStyle(.subtle, padding: Theme.Spacing.xl, cornerRadius: Theme.Radius.lg)
    }
}

private struct SourcesListContent: View {
    let viewModel: SourcesViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
            if !viewModel.needsAttentionSources.isEmpty {
                SourcesSection(title: "Needs Attention", subtitle: "Sources that need review before they become silent failures.", sources: viewModel.needsAttentionSources, viewModel: viewModel)
            }

            if !viewModel.unknownSources.isEmpty {
                SourcesSection(title: "Unknown", subtitle: "Sources that are active but have not yet established a current health classification.", sources: viewModel.unknownSources, viewModel: viewModel)
            }

            if !viewModel.healthySources.isEmpty {
                SourcesSection(title: "Healthy", subtitle: "Sources running normally with recent successful runs.", sources: viewModel.healthySources, viewModel: viewModel)
            }

            if !viewModel.pausedSources.isEmpty {
                SourcesSection(title: "Paused", subtitle: "Sources kept out of rotation until you resume them.", sources: viewModel.pausedSources, viewModel: viewModel)
            }
        }
    }
}

private struct SourcesSection: View {
    let title: String
    let subtitle: String
    let sources: [Source]
    let viewModel: SourcesViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(sources) { source in
                SourceDetailCard(source: source, viewModel: viewModel)
            }
        }
    }
}

private struct SourceDetailCard: View {
    let source: Source
    let viewModel: SourcesViewModel
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isExpanded: Bool = false
    @State private var scrapeRuns: [ScrapeRun] = []
    @State private var scrapeRunsErrorMessage: String?
    @State private var isLoadingRuns: Bool = false
    @State private var selectedInterval: Int = 0
    @State private var isActive: Bool = false
    @State private var isHovered: Bool = false

    private static let preferredIntervalPresets = [60, 360, 720, 1440]

    init(source: Source, viewModel: SourcesViewModel) {
        self.source = source
        self.viewModel = viewModel
        _selectedInterval = State(initialValue: source.crawlIntervalMinutes)
        _isActive = State(initialValue: source.isActive)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.16)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(alignment: .top, spacing: Theme.Spacing.md) {
                    ZStack(alignment: .bottomTrailing) {
                        SourceLogo(sourceCode: source.code, size: 28)
                        Circle()
                            .fill(source.isActive ? Color.scoreGood : Color.secondary)
                            .frame(width: 8, height: 8)
                            .overlay {
                                Circle().stroke(Color(nsColor: .controlBackgroundColor), lineWidth: 1.5)
                            }
                            .offset(x: 2, y: 2)
                    }

                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        HStack(spacing: Theme.Spacing.xs) {
                            Text(source.name)
                                .font(.body.weight(.medium))
                            if !source.isActive {
                                StatusBadge(label: "Paused", color: .secondary, icon: "pause.fill")
                            }
                        }

                        Text(readinessText)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }

                    Spacer(minLength: Theme.Spacing.md)

                    VStack(alignment: .trailing, spacing: Theme.Spacing.xxs) {
                        StatusBadge(healthStatus: source.healthStatus)
                        Text(intervalLabel)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                        Text("\(source.successRatePct.formatted(.number.precision(.fractionLength(1))))% success")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }

                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 0 : -90))
                }
                .padding(Theme.Spacing.md)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Divider()
                .padding(.horizontal, Theme.Spacing.md)

            HStack(spacing: Theme.Spacing.lg) {
                Toggle("Active", isOn: $isActive)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .onChange(of: isActive) { _, newValue in
                        guard newValue != source.isActive else { return }
                        Task { await viewModel.toggleActive(source, using: appState.apiClient) }
                    }

                Divider()
                    .frame(height: 16)

                HStack(spacing: Theme.Spacing.xs) {
                    Text("Interval")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Picker("", selection: $selectedInterval) {
                        ForEach(intervalOptions, id: \.self) { minutes in
                            Text(formatInterval(minutes)).tag(minutes)
                        }
                    }
                    .pickerStyle(.menu)
                    .controlSize(.small)
                    .frame(width: 72)
                    .onChange(of: selectedInterval) { _, newValue in
                        guard newValue != source.crawlIntervalMinutes else { return }
                        Task { await viewModel.updateInterval(source, minutes: newValue, using: appState.apiClient) }
                    }
                }

                Divider()
                    .frame(height: 16)

                Button {
                    Task { await viewModel.triggerRun(source, using: appState.apiClient) }
                } label: {
                    HStack(spacing: Theme.Spacing.xs) {
                        if viewModel.runningSourceIDs.contains(source.id) {
                            ProgressView()
                                .controlSize(.mini)
                        } else {
                            Image(systemName: "play.fill")
                                .font(.caption2)
                        }
                        Text("Run Now")
                            .font(.caption)
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(viewModel.runningSourceIDs.contains(source.id) || !source.isActive)
                .help(source.isActive ? "Trigger a manual scrape run" : "Enable source to run")

                Spacer()
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.vertical, Theme.Spacing.sm)

            if isExpanded {
                Divider()
                    .padding(.horizontal, Theme.Spacing.md)

                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    HStack(spacing: Theme.Spacing.xl) {
                        DetailItem(label: "Source Code", value: source.code)
                        DetailItem(label: "Total Ingested", value: PriceFormatter.formatCompact(source.totalListingsIngested))
                        DetailItem(label: "Interval", value: intervalLabel)
                    }

                    if let errorSummary = source.lastErrorSummary {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                            Text("Last Error")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                            Text(errorSummary)
                                .font(.caption)
                                .foregroundStyle(.primary)
                                .padding(Theme.Spacing.sm)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.scorePoor.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
                        }
                    }

                    if isLoadingRuns {
                        ProgressView()
                            .controlSize(.small)
                    } else if let scrapeRunsErrorMessage {
                        ContentUnavailableView {
                            Label("Couldn’t Load Recent Runs", systemImage: "exclamationmark.triangle")
                        } description: {
                            Text(scrapeRunsErrorMessage)
                        } actions: {
                            Button("Retry", action: retryLoadScrapeRuns)
                                .buttonStyle(.bordered)
                        }
                    } else {
                        ScrapeRunsView(runs: scrapeRuns)
                    }
                }
                .padding(Theme.Spacing.md)
                .task {
                    await loadScrapeRunsIfNeeded()
                }
            }
        }
        .opacity(source.isActive ? 1.0 : 0.76)
        .background(Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .stroke(Color(nsColor: .separatorColor).opacity(isHovered ? 0.24 : 0.14), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
        .onHover { isHovered = $0 }
        .onChange(of: source.crawlIntervalMinutes) { _, newValue in
            selectedInterval = newValue
        }
        .onChange(of: source.isActive) { _, newValue in
            isActive = newValue
        }
        .contextMenu {
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(source.code, forType: .string)
            } label: {
                Label("Copy Source Code", systemImage: "doc.on.clipboard")
            }
            Button {
                Task { await viewModel.toggleActive(source, using: appState.apiClient) }
            } label: {
                Label(
                    source.isActive ? "Deactivate" : "Activate",
                    systemImage: source.isActive ? "pause.circle" : "play.circle"
                )
            }
        }
    }

    private var readinessText: String {
        switch source.healthStatus {
        case .blocked:
            return source.lastErrorSummary ?? "Blocked or repeatedly failing. Intervention is required before the source goes silent."
        case .degraded:
            return source.lastErrorSummary ?? "Running with elevated risk or reduced success rate."
        case .healthy:
            if let lastRun = source.lastSuccessfulRun {
                return "Last successful run \(PriceFormatter.relativeDate(lastRun))."
            }
            return "Healthy, but no successful run has been recorded yet."
        case .disabled:
            return "Source is disabled and removed from scheduled runs."
        case .unknown:
            return "Source health has not been determined yet."
        }
    }

    private var intervalLabel: String {
        formatInterval(source.crawlIntervalMinutes)
    }

    private var intervalOptions: [Int] {
        Set(Self.preferredIntervalPresets + [source.crawlIntervalMinutes])
            .sorted()
    }

    private func loadScrapeRunsIfNeeded() async {
        guard scrapeRuns.isEmpty, scrapeRunsErrorMessage == nil else { return }
        await loadScrapeRuns()
    }

    private func loadScrapeRuns() async {
        isLoadingRuns = true
        scrapeRunsErrorMessage = nil

        let result = await viewModel.fetchRecentRuns(for: source.code, using: appState.apiClient)
        switch result {
        case .success(let runs):
            scrapeRuns = runs
        case .failure(let error):
            scrapeRuns = []
            scrapeRunsErrorMessage = error.localizedDescription
        }

        isLoadingRuns = false
    }

    private func retryLoadScrapeRuns() {
        Task { await loadScrapeRuns() }
    }

    private func formatInterval(_ minutes: Int) -> String {
        if minutes < 60 {
            return "\(minutes)m"
        }
        if minutes % 1440 == 0 {
            let days = minutes / 1440
            return "\(days)d"
        }
        if minutes % 60 != 0 {
            let hours = Double(minutes) / 60
            return "\(hours.formatted(.number.precision(.fractionLength(1))))h"
        }
        let hours = minutes / 60
        return "\(hours)h"
    }
}

private struct DetailItem: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.medium))
        }
    }
}

#Preview {
    SourcesView()
        .environment(AppState())
        .frame(width: 900, height: 700)
}
