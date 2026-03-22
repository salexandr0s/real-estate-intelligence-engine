import SwiftUI

/// Row showing a single source's name, last run time, and health badge.
struct SourceHealthRow: View {
    let source: Source

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            SourceLogo(sourceCode: source.code, size: 20)

            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(source.name)
                    .font(.body)
                if let lastRun = source.lastSuccessfulRun {
                    Text("Last run: \(PriceFormatter.relativeDate(lastRun))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            StatusBadge(healthStatus: source.healthStatus)
        }
        .padding(.vertical, Theme.Spacing.sm)
    }
}
