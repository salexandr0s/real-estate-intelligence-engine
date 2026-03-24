import SwiftUI

/// Deprecated — refresh controls moved to DashboardView toolbar.
@available(*, deprecated, message: "Refresh moved to DashboardView toolbar")
struct DashboardHeader: View {
    let lastRefresh: Date?
    let isLoading: Bool
    let onRefresh: () -> Void

    var body: some View {
        EmptyView()
    }
}
