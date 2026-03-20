import SwiftUI

/// Colored badge for displaying source health status or listing status.
struct StatusBadge: View {
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: Theme.Spacing.xs) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(label)
                .font(.caption)
                .fontWeight(.medium)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(color.opacity(0.12))
        .clipShape(Capsule())
    }
}

/// Convenience initializer for source health status.
extension StatusBadge {
    init(healthStatus: SourceHealthStatus) {
        self.label = healthStatus.displayName
        self.color = Theme.healthColor(for: healthStatus)
    }

    init(listingStatus: ListingStatus) {
        self.label = listingStatus.rawValue.capitalized
        switch listingStatus {
        case .active:
            self.color = .green
        case .inactive:
            self.color = .secondary
        case .withdrawn:
            self.color = .orange
        case .sold, .rented:
            self.color = .blue
        case .expired:
            self.color = .red
        case .unknown:
            self.color = .gray
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        StatusBadge(healthStatus: .healthy)
        StatusBadge(healthStatus: .degraded)
        StatusBadge(healthStatus: .failing)
        StatusBadge(healthStatus: .disabled)
        StatusBadge(listingStatus: .active)
        StatusBadge(listingStatus: .sold)
    }
    .padding()
}
