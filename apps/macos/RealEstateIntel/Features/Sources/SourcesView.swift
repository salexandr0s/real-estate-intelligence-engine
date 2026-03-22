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
                    SourcesListContent(sources: viewModel.sources) { source in
                        Task { await viewModel.toggleActive(source, using: appState.apiClient) }
                    }
                }
            }
            .padding(Theme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .navigationTitle("Sources")
        .toolbar {
            ToolbarItemGroup {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }

                Button {
                    Task { await viewModel.togglePauseAll(using: appState.apiClient) }
                } label: {
                    Label(
                        viewModel.allPaused ? "Resume All" : "Pause All",
                        systemImage: viewModel.allPaused ? "play.fill" : "pause.fill"
                    )
                }
                .disabled(viewModel.sources.isEmpty)

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
                .fontWeight(.semibold)
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
    let sources: [Source]
    let onToggle: (Source) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Sources")
                .font(.headline)

            ForEach(sources) { source in
                SourceDetailCard(source: source) { onToggle(source) }
            }
        }
    }
}

// MARK: - Source Detail Card

private struct SourceDetailCard: View {
    let source: Source
    let onToggle: () -> Void
    @State private var isExpanded: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Main row
            HStack(spacing: Theme.Spacing.md) {
                // Active indicator (clickable)
                Circle()
                    .fill(source.isActive ? Color.green : Color.gray)
                    .frame(width: 10, height: 10)
                    .onTapGesture(perform: onToggle)
                    .help(source.isActive ? "Click to pause" : "Click to resume")

                // Source name
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    HStack(spacing: Theme.Spacing.xs) {
                        Text(source.name)
                            .font(.body)
                            .fontWeight(.medium)

                        if !source.isActive {
                            Text("Paused")
                                .font(.caption2)
                                .fontWeight(.medium)
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
                    Text("\(source.successRatePct, specifier: "%.1f")%")
                        .font(.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(successRateColor)
                    Text("success rate")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                // Crawl interval
                VStack(alignment: .trailing, spacing: Theme.Spacing.xxs) {
                    Text("\(source.crawlIntervalMinutes)m")
                        .font(.body)
                        .fontWeight(.medium)
                    Text("interval")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(width: 60)

                // Health badge
                StatusBadge(healthStatus: source.healthStatus)

                // Expand button
                Button {
                    withAnimation(.easeInOut(duration: 0.16)) {
                        isExpanded.toggle()
                    }
                } label: {
                    Image(systemName: "chevron.down")
                        .rotationEffect(.degrees(isExpanded ? 0 : -90))
                        .foregroundStyle(.secondary)
                        .font(.caption)
                }
                .buttonStyle(.plain)
            }
            .padding(Theme.Spacing.md)

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
                                .fontWeight(.medium)
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
                }
                .padding(Theme.Spacing.md)
            }
        }
        .opacity(source.isActive ? 1.0 : 0.5)
        .background(Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .shadow(radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
    }

    private var successRateColor: Color {
        switch source.successRatePct {
        case 90...: .sourceHealthy
        case 70..<90: .sourceDegraded
        default: .sourceFailing
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
                .fontWeight(.medium)
        }
    }
}

#Preview {
    SourcesView()
        .environment(AppState())
        .frame(width: 900, height: 700)
}
