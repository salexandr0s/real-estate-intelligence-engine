import SwiftUI

/// Small badge showing a matched threshold criterion (price, area, rooms, score).
struct ThresholdBadge: View {
    let label: String

    var body: some View {
        HStack(spacing: Theme.Spacing.xxs) {
            Image(systemName: "checkmark")
                .font(.system(size: 8, weight: .bold))
            Text(label)
                .font(.caption2)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xxs)
        .background(Color.green.opacity(0.12))
        .clipShape(Capsule())
    }
}
