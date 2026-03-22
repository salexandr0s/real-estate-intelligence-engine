import SwiftUI

struct AlertRow: View {
    let alert: Alert

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Unread indicator
            Circle()
                .fill(alert.status == .unread ? Color.accentColor : Color.clear)
                .frame(width: 8, height: 8)

            // Type icon (decorative — badge text conveys type to VoiceOver)
            Image(systemName: alert.alertType.iconName)
                .foregroundStyle(Theme.alertColor(for: alert.alertType))
                .font(.title3)
                .frame(width: 24, alignment: .center)
                .accessibilityHidden(true)

            // Content
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(alert.title)
                    .font(.body)
                    .fontWeight(alert.status == .unread ? .semibold : .regular)
                    .lineLimit(1)

                Text(alert.body)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                HStack(spacing: Theme.Spacing.sm) {
                    if let filterName = alert.filterName {
                        Label(filterName, systemImage: "line.3.horizontal.decrease.circle")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }

                    Text(PriceFormatter.relativeDate(alert.matchedAt))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            // Alert type badge
            Text(alert.alertType.displayName)
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(Theme.alertColor(for: alert.alertType))
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, Theme.Spacing.xxs)
                .background(Theme.alertColor(for: alert.alertType).opacity(0.12))
                .clipShape(Capsule())
        }
        .padding(.vertical, Theme.Spacing.xs)
        .opacity(alert.status == .dismissed ? 0.6 : 1.0)
    }
}
