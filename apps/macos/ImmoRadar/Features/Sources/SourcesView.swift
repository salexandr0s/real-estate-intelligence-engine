import AppKit
import SwiftUI

/// Sources monitoring view showing source health and recent operational details.
struct SourcesView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = SourcesViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                if let error = viewModel.errorMessage {
                    SourcesErrorBanner(message: error) {
                        Task { await viewModel.refresh(using: appState.apiClient) }
                    } onDismiss: {
                        viewModel.clearError()
                    }
                }

                SourcesSummaryBar(viewModel: viewModel)

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
            await viewModel.refresh(using: appState.apiClient)
        }
    }
}

private struct SourcesSummaryBar: View {
    let viewModel: SourcesViewModel

    private let columns = [GridItem(.adaptive(minimum: 180, maximum: 260), spacing: Theme.Spacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.md) {
            SourcesSummaryMetric(title: "Active Sources", value: "\(viewModel.activeCount)", detail: "currently scheduled", icon: "bolt.fill", tint: .accentColor)
            SourcesSummaryMetric(title: "Needs Attention", value: "\(viewModel.attentionCount)", detail: "failing or degraded", icon: "exclamationmark.triangle.fill", tint: viewModel.attentionCount > 0 ? .scoreAverage : .secondary)
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

private struct SourcesErrorBanner: View {
    let message: String
    let onRetry: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.scoreAverage)
            VStack(alignment: .leading, spacing: 2) {
                Text("Couldn’t refresh source health.")
                    .font(.callout.weight(.semibold))
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            Button("Dismiss", action: onDismiss)
                .buttonStyle(.bordered)
                .controlSize(.small)
            Button("Retry", action: onRetry)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
        .padding(Theme.Spacing.md)
        .background(Color.scoreAverage.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
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

    private static let intervalPresets = [15, 30, 60, 120]

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
                            .font(.caption2)
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
                        ForEach(Self.intervalPresets, id: \.self) { minutes in
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
        .onAppear {
            selectedInterval = source.crawlIntervalMinutes
            isActive = source.isActive
        }
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
        case .failing:
            return source.lastErrorSummary ?? "Failing health checks and needs intervention."
        case .degraded:
            return source.lastErrorSummary ?? "Running with elevated risk or reduced success rate."
        case .healthy:
            if let lastRun = source.lastSuccessfulRun {
                return "Last successful run \(PriceFormatter.relativeDate(lastRun))."
            }
            return "Healthy, but no successful run has been recorded yet."
        case .disabled:
            return "Source is paused and not participating in scheduled runs."
        case .unknown:
            return "Source health has not been determined yet."
        }
    }

    private var intervalLabel: String {
        formatInterval(source.crawlIntervalMinutes)
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
