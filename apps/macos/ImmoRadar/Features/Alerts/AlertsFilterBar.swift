import SwiftUI

struct AlertsFilterBar: View {
    @Bindable var viewModel: AlertsViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .center, spacing: Theme.Spacing.md) {
                Picker("Scope", selection: $viewModel.scope) {
                    ForEach(AlertsScope.allCases, id: \.self) { scope in
                        Text(scope.displayName).tag(scope)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 420)

                Spacer(minLength: 0)

                HStack(spacing: Theme.Spacing.sm) {
                    VStack(alignment: .trailing, spacing: 3) {
                        Text("Sort")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack(spacing: Theme.Spacing.xs) {
                            Picker("Sort", selection: $viewModel.sortBy) {
                                ForEach(AlertSortBy.allCases, id: \.self) { sortBy in
                                    Text(sortBy.displayName).tag(sortBy)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.segmented)
                            .frame(width: 240)

                            Button(
                                "Sort \(viewModel.sortDirection.displayName)",
                                systemImage: viewModel.sortDirection.iconName,
                                action: viewModel.toggleSortDirection
                            )
                            .labelStyle(.iconOnly)
                            .frame(width: 20, height: 20)
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .help("Toggle sort direction")
                        }
                    }
                }
            }

            HStack(alignment: .center, spacing: Theme.Spacing.md) {
                Text("Sorting by \(viewModel.sortDescription)")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("^[\(viewModel.visibleCount) visible alert](inflect: true)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)

                    Text("^[\(viewModel.unreadCount) unread total](inflect: true)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Color(nsColor: .windowBackgroundColor).opacity(0.85))
    }
}
