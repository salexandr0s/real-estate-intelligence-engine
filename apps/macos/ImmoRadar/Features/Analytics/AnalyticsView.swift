import SwiftUI

/// Analytics view showing market baselines, trends, and temperature data.
struct AnalyticsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AnalyticsViewModel()
    @State private var selectedTab: AnalyticsTab = .overview

    enum AnalyticsTab: String, CaseIterable {
        case overview = "Overview"
        case trends = "Trends"
        case temperature = "Temperature"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                if let error = viewModel.errorMessage {
                    AnalyticsErrorBanner(message: error) {
                        Task { await viewModel.refresh(using: appState.apiClient) }
                    }
                }

                switch selectedTab {
                case .overview:
                    if viewModel.baselines.isEmpty && !viewModel.isLoading {
                        AnalyticsEmptyState()
                    } else {
                        AnalyticsSummaryBar(viewModel: viewModel)
                        AnalyticsDistrictTable(districts: viewModel.districtBreakdown)
                    }

                case .trends:
                    DistrictTrendChartView(data: viewModel.trendData) { months in
                        Task { await viewModel.refreshTrends(using: appState.apiClient, months: months) }
                    }

                case .temperature:
                    MarketTemperatureView(data: viewModel.temperatureData)
                }
            }
            .padding(Theme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .navigationTitle("Analytics")
        .toolbar {
            ToolbarItemGroup {
                Picker("Tab", selection: $selectedTab) {
                    ForEach(AnalyticsTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 280)

                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }

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

private struct AnalyticsSummaryBar: View {
    let viewModel: AnalyticsViewModel

    var body: some View {
        HStack(spacing: Theme.Spacing.xl) {
            AnalyticsSummaryCard(
                title: "Total Listings",
                value: PriceFormatter.formatCompact(viewModel.totalListings),
                icon: "building.2.fill",
                color: .accentColor
            )

            AnalyticsSummaryCard(
                title: "Avg Price/m\u{00B2}",
                value: PriceFormatter.formatPerSqm(viewModel.averagePricePerSqm),
                icon: "eurosign.circle.fill",
                color: .green
            )

            AnalyticsSummaryCard(
                title: "Districts",
                value: "\(viewModel.districtBreakdown.count)",
                icon: "map.fill",
                color: .orange
            )

            AnalyticsSummaryCard(
                title: "Baselines",
                value: "\(viewModel.baselines.count)",
                icon: "chart.bar.fill",
                color: .purple
            )
        }
    }
}

private struct AnalyticsSummaryCard: View {
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

// MARK: - District Table

private struct AnalyticsDistrictTable: View {
    let districts: [DistrictSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("District Breakdown")
                .font(.headline)

            Table(districts) {
                TableColumn("District") { district in
                    Text(district.districtLabel)
                        .font(.body)
                }
                .width(min: 100, ideal: 140)

                TableColumn("Median Price/m\u{00B2}") { district in
                    Text(PriceFormatter.formatPerSqm(district.medianPpsqmEur))
                        .font(.body)
                        .monospacedDigit()
                }
                .width(min: 120, ideal: 160)

                TableColumn("P25 Price/m\u{00B2}") { district in
                    Text(PriceFormatter.formatPerSqm(district.p25PpsqmEur))
                        .font(.body)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .width(min: 120, ideal: 160)

                TableColumn("P75 Price/m\u{00B2}") { district in
                    Text(PriceFormatter.formatPerSqm(district.p75PpsqmEur))
                        .font(.body)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .width(min: 120, ideal: 160)

                TableColumn("Sample Count") { district in
                    Text(PriceFormatter.formatCompact(district.sampleCount))
                        .font(.body)
                        .monospacedDigit()
                }
                .width(min: 80, ideal: 100)
            }
            .tableStyle(.inset(alternatesRowBackgrounds: true))
            .frame(minHeight: 300)
        }
    }
}

// MARK: - Empty State

private struct AnalyticsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label("No Analytics Data", systemImage: "chart.bar.xaxis")
        } description: {
            Text("Market baselines will appear here once enough listing data has been collected.")
        }
        .frame(maxWidth: .infinity, minHeight: 300)
    }
}

// MARK: - Error Banner

private struct AnalyticsErrorBanner: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)

            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            Spacer()

            Button("Retry", action: onRetry)
                .controlSize(.small)
        }
        .padding(Theme.Spacing.md)
        .background(Color.orange.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
    }
}

#Preview {
    AnalyticsView()
        .environment(AppState())
        .frame(width: 900, height: 700)
}
