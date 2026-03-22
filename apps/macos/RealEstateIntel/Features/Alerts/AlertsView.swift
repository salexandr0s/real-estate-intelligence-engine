import SwiftUI

/// Alerts view with status filtering, list, detail inspector, and context menu actions.
struct AlertsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AlertsViewModel()
    @State private var showInspector: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            AlertsFilterBar(viewModel: viewModel)
            Divider()

            if viewModel.filteredAlerts.isEmpty && !viewModel.isLoading {
                AlertsEmptyState(hasFilter: viewModel.filterStatus != nil)
            } else {
                AlertsList(
                    viewModel: viewModel,
                    appState: appState
                )
            }
        }
        .navigationTitle("Alerts")
        .inspector(isPresented: $showInspector) {
            AlertInspectorContent(alert: viewModel.selectedAlert)
                .inspectorColumnWidth(min: 300, ideal: 360, max: 480)
        }
        .toolbar {
            ToolbarItemGroup {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }

                if viewModel.unreadCount > 0 {
                    Text("\(viewModel.unreadCount) unread")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Button {
                    showInspector.toggle()
                } label: {
                    Label("Inspector", systemImage: "sidebar.right")
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
        .onChange(of: viewModel.selectedAlertID) { _, newValue in
            if newValue != nil {
                showInspector = true
            }
        }
    }
}

// MARK: - Filter Bar

private struct AlertsFilterBar: View {
    @Bindable var viewModel: AlertsViewModel

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Picker("Status", selection: $viewModel.filterStatus) {
                Text("All").tag(Optional<AlertStatus>.none)
                ForEach(AlertStatus.allCases, id: \.self) { status in
                    Text(status.displayName).tag(Optional(status))
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 360)

            Spacer()
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.sm)
    }
}

// MARK: - Empty State

private struct AlertsEmptyState: View {
    let hasFilter: Bool

    var body: some View {
        ContentUnavailableView {
            Label(
                hasFilter ? "No Matching Alerts" : "No Alerts",
                systemImage: "bell.slash"
            )
        } description: {
            Text(
                hasFilter
                    ? "No alerts match the selected status filter."
                    : "When listings match your filters, alerts will appear here."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Alerts List

private struct AlertsList: View {
    @Bindable var viewModel: AlertsViewModel
    let appState: AppState

    var body: some View {
        List(viewModel.filteredAlerts, selection: $viewModel.selectedAlertID) { alert in
            AlertRow(alert: alert)
                .tag(alert.id)
                .contextMenu {
                    if alert.status == .unread {
                        Button {
                            Task { await viewModel.markAsRead(alert, using: appState.apiClient) }
                        } label: {
                            Label("Mark as Read", systemImage: "envelope.open")
                        }
                    }

                    if alert.status != .dismissed {
                        Button {
                            Task { await viewModel.dismiss(alert, using: appState.apiClient) }
                        } label: {
                            Label("Dismiss", systemImage: "xmark.circle")
                        }
                    }
                }
        }
        .listStyle(.inset(alternatesRowBackgrounds: true))
    }
}

// MARK: - Alert Row

private struct AlertRow: View {
    let alert: Alert

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Unread indicator
            Circle()
                .fill(alert.status == .unread ? Color.accentColor : Color.clear)
                .frame(width: 8, height: 8)

            // Type icon
            Image(systemName: alert.alertType.iconName)
                .foregroundStyle(Theme.alertColor(for: alert.alertType))
                .font(.title3)
                .frame(width: 24, alignment: .center)

            // Content
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(alert.title)
                    .font(.body)
                    .fontWeight(alert.status == .unread ? .semibold : .regular)
                    .lineLimit(1)

                Text(alert.body)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                HStack(spacing: Theme.Spacing.sm) {
                    if let filterName = alert.filterName {
                        Label(filterName, systemImage: "line.3.horizontal.decrease.circle")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }

                    Text(PriceFormatter.relativeDate(alert.matchedAt))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            // Alert type badge
            Text(alert.alertType.displayName)
                .font(.caption2)
                .fontWeight(.medium)
                .foregroundStyle(Theme.alertColor(for: alert.alertType))
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, Theme.Spacing.xxs)
                .background(Theme.alertColor(for: alert.alertType).opacity(0.12))
                .clipShape(Capsule())
        }
        .padding(.vertical, Theme.Spacing.xs)
        .opacity(alert.status == .dismissed ? 0.6 : 1.0)
    }
}

// MARK: - Alert Inspector

private struct AlertInspectorContent: View {
    let alert: Alert?

    var body: some View {
        if let alert {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                    // Header
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        HStack(spacing: Theme.Spacing.sm) {
                            Image(systemName: alert.alertType.iconName)
                                .foregroundStyle(Theme.alertColor(for: alert.alertType))
                                .font(.title2)

                            Text(alert.alertType.displayName)
                                .font(.headline)
                                .foregroundStyle(Theme.alertColor(for: alert.alertType))
                        }

                        Text(alert.title)
                            .font(.title3)
                            .fontWeight(.semibold)
                    }

                    Divider()

                    // Body
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Details")
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundStyle(.secondary)

                        Text(alert.body)
                            .font(.body)
                    }

                    // Metadata
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        Text("Info")
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundStyle(.secondary)

                        InspectorDetailRow(label: "Status", value: alert.status.displayName)
                        InspectorDetailRow(label: "Matched", value: PriceFormatter.formatDateTime(alert.matchedAt))

                        if let filterName = alert.filterName {
                            InspectorDetailRow(label: "Filter", value: filterName)
                        }

                        if alert.listingId != nil {
                            InspectorDetailRow(label: "Listing ID", value: "#\(alert.listingId!)")
                        }
                    }

                    // Linked listing hint
                    if alert.listingId != nil {
                        Divider()

                        Text("Listing #\(alert.listingId!) — view in Listings tab")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(Theme.Spacing.lg)
            }
        } else {
            ContentUnavailableView(
                "No Alert Selected",
                systemImage: "bell",
                description: Text("Select an alert to view its details.")
            )
        }
    }
}

// MARK: - Inspector Detail Row

private struct InspectorDetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 80, alignment: .leading)
            Text(value)
                .font(.caption)
        }
    }
}

#Preview {
    AlertsView()
        .environment(AppState())
        .frame(width: 900, height: 600)
}
