import SwiftUI

struct AlertsEmptyState: View {
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
