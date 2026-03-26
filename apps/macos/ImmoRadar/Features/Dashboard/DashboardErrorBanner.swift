import SwiftUI

/// Subtle warning banner shown when dashboard API calls fail.
struct DashboardErrorBanner: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .font(.caption)

            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            Spacer()

            Button("Retry", action: onRetry)
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentColor)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Color.orange.opacity(0.08))
        .clipShape(.rect(cornerRadius: Theme.Radius.sm))
        .accessibilityElement(children: .combine)
    }
}
