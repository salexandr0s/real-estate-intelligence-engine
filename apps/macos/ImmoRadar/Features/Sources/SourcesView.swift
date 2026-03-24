import AppKit
import SwiftUI

/// Sources monitoring view showing scraping source health, success rates, and details.
struct SourcesView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = SourcesViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
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

// MARK: - Summary Bar

private struct SourcesSummaryBar: View {
    let viewModel: SourcesViewModel

    var body: some View {
        HStack(spacing: Theme.Spacing.xl) {
            SourcesSummaryCard(
                title: "Total Sources",
                value: "\(viewModel.sources.count)",
                icon: "globe",
                color: .accentColor
            )

            SourcesSummaryCard(
                title: "Active",
                value: "\(viewModel.activeCount)",
                icon: "bolt.fill",
                color: .green
            )

            SourcesSummaryCard(
                title: "Healthy",
                value: "\(viewModel.healthyCount)",
                icon: "checkmark.circle.fill",
                color: .sourceHealthy
            )

            SourcesSummaryCard(
                title: "Degraded",
                value: "\(viewModel.degradedCount)",
                icon: "exclamationmark.triangle.fill",
                color: .sourceDegraded
            )

            SourcesSummaryCard(
                title: "Failing",
                value: "\(viewModel.failingCount)",
                icon: "xmark.circle.fill",
                color: .sourceFailing
            )

            SourcesSummaryCard(
                title: "Total Ingested",
                value: PriceFormatter.formatCompact(viewModel.totalListingsIngested),
                icon: "tray.full.fill",
                color: .secondary
            )
        }
    }
}

private struct SourcesSummaryCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(spacing: Theme.Spacing.xs) {
                Image(systemName: icon)
                    .foregroundStyle(color)
                    .font(.caption)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(value)
                .font(.title2)
                .adaptiveFontWeight(.semibold)
        }
        .padding(Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .shadow(radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
    }
}

// MARK: - Empty State

private struct SourcesEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label("No Sources", systemImage: "globe")
        } description: {
            Text("Scraping sources will appear here once configured.")
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Sources List

private struct SourcesListContent: View {
    let viewModel: SourcesViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Sources")
                .font(.headline)

            ForEach(viewModel.sources) { source in
                SourceDetailCard(source: source, viewModel: viewModel)
            }
        }
    }
}

// MARK: - Source Detail Card

private struct SourceDetailCard: View {
    let source: Source
    let viewModel: SourcesViewModel
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isExpanded: Bool = false
    @State private var scrapeRuns: [ScrapeRun] = []
    @State private var isLoadingRuns: Bool = false
    @State private var selectedInterval: Int = 0
    @State private var isHovered: Bool = false

    /// Preset crawl interval options in minutes.
    private static let intervalPresets = [15, 30, 60, 120]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Main row
            HStack(spacing: Theme.Spacing.md) {
                // Source logo with active indicator overlay
                ZStack(alignment: .bottomTrailing) {
                    SourceLogo(sourceCode: source.code, size: 28)
                    Circle()
                        .fill(source.isActive ? Color.green : Color.gray)
                        .frame(width: 8, height: 8)
                        .overlay(
                            Circle().stroke(Color(nsColor: .controlBackgroundColor), lineWidth: 1.5)
                        )
                        .offset(x: 2, y: 2)
                }

                // Source name
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    HStack(spacing: Theme.Spacing.xs) {
                        Text(source.name)
                            .font(.body)
                            .adaptiveFontWeight(.medium)

                        if !source.isActive {
                            Text("Paused")
                                .font(.caption2)
                                .adaptiveFontWeight(.medium)
                                .foregroundStyle(.orange)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.orange.opacity(0.12))
                                .clipShape(Capsule())
                        }
                    }

                    if let lastRun = source.lastSuccessfulRun {
                        Text("Last run: \(PriceFormatter.relativeDate(lastRun))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Never run")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }

                Spacer()

                // Success rate
                VStack(alignment: .trailing, spacing: Theme.Spacing.xxs) {
                    Text("\(source.successRatePct.formatted(.number.precision(.fractionLength(1))))%")
                        .font(.body)
                        .adaptiveFontWeight(.semibold)
                        .foregroundStyle(successRateColor)
                    Text("success rate")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                // Health badge
                StatusBadge(healthStatus: source.healthStatus)

                // Expand button
                Button(isExpanded ? "Collapse" : "Expand", systemImage: "chevron.down") {
                    withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.16)) {
                        isExpanded.toggle()
                    }
                }
                .labelStyle(.iconOnly)
                .rotationEffect(.degrees(isExpanded ? 0 : -90))
                .foregroundStyle(.secondary)
                .font(.caption)
                .buttonStyle(.plain)
            }
            .padding(Theme.Spacing.md)

            // Controls row
            Divider()
                .padding(.horizontal, Theme.Spacing.md)

            HStack(spacing: Theme.Spacing.lg) {
                // Active toggle
                Toggle(isOn: Binding(
                    get: { source.isActive },
                    set: { _ in
                        Task { await viewModel.toggleActive(source, using: appState.apiClient) }
                    }
                )) {
                    Text("Active")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)

                Divider()
                    .frame(height: 16)

                // Crawl interval picker
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

                // Run Now button
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

            // Expanded detail
            if isExpanded {
                Divider()
                    .padding(.horizontal, Theme.Spacing.md)

                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    HStack(spacing: Theme.Spacing.xl) {
                        DetailItem(
                            label: "Source Code",
                            value: source.code
                        )

                        DetailItem(
                            label: "Total Ingested",
                            value: PriceFormatter.formatCompact(source.totalListingsIngested)
                        )

                        DetailItem(
                            label: "Status",
                            value: source.isActive ? "Active" : "Disabled"
                        )
                    }

                    if let errorSummary = source.lastErrorSummary {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                            Text("Last Error")
                                .font(.caption)
                                .adaptiveFontWeight(.medium)
                                .foregroundStyle(.secondary)

                            Text(errorSummary)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .padding(Theme.Spacing.sm)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.red.opacity(0.06))
                                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                        }
                    }

                    if isLoadingRuns {
                        ProgressView()
                            .controlSize(.small)
                    } else if !scrapeRuns.isEmpty {
                        Divider()
                        ScrapeRunsView(runs: scrapeRuns)
                    }
                }
                .padding(Theme.Spacing.md)
                .task {
                    guard scrapeRuns.isEmpty else { return }
                    isLoadingRuns = true
                    do {
                        let allRuns = try await appState.apiClient.fetchScrapeRuns(limit: 200)
                        scrapeRuns = allRuns.filter { $0.sourceCode == source.code }.prefix(10).map { $0 }
                    } catch {
                        scrapeRuns = []
                    }
                    isLoadingRuns = false
                }
            }
        }
        .opacity(source.isActive ? 1.0 : 0.7)
        .background(Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .shadow(radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .stroke(Color(nsColor: .separatorColor).opacity(isHovered ? 0.3 : 0), lineWidth: 1)
        )
        .onHover { isHovered = $0 }
        .onAppear { selectedInterval = source.crawlIntervalMinutes }
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

    private var successRateColor: Color {
        switch source.successRatePct {
        case 90...: .sourceHealthy
        case 70..<90: .sourceDegraded
        default: .sourceFailing
        }
    }

    private func formatInterval(_ minutes: Int) -> String {
        if minutes < 60 {
            return "\(minutes)m"
        } else {
            let hours = minutes / 60
            return "\(hours)h"
        }
    }
}

// MARK: - Detail Item

private struct DetailItem: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .adaptiveFontWeight(.medium)
        }
    }
}

#Preview {
    SourcesView()
        .environment(AppState())
        .frame(width: 900, height: 700)
}
