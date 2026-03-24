import SwiftUI

/// A single row in the proximity metrics (kept for backward compatibility).
struct ProximityRow: View {
    let icon: String
    let color: Color
    let text: String
    let detail: String?

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: icon)
                .font(.caption2)
                .foregroundStyle(color)
                .frame(width: 14)

            VStack(alignment: .leading, spacing: 0) {
                Text(text)
                    .font(.caption)
                if let detail {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
