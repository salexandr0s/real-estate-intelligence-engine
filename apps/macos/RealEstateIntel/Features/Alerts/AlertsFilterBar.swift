import SwiftUI

struct AlertsFilterBar: View {
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
