import SwiftUI

struct AlertsFilterBar: View {
    @Bindable var viewModel: AlertsViewModel

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.md) {
            Picker("Scope", selection: $viewModel.scope) {
                ForEach(AlertsScope.allCases, id: \.self) { scope in
                    Text(scope.displayName).tag(scope)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 420)

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
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Color(nsColor: .windowBackgroundColor).opacity(0.85))
    }
}
