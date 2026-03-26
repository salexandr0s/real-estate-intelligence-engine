import SwiftUI

/// Compact summary metric — icon, value, label, and optional delta in a tight card.
@available(*, deprecated, message: "Replaced by SummaryStripView")
struct SummaryCardView: View {
    let card: DashboardViewModel.SummaryCard
    var onNavigate: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: card.icon)
                .font(.body)
                .foregroundStyle(card.color)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 0) {
                Text(card.value)
                    .font(.title2.bold())
                    .fontDesign(.rounded)
                    .contentTransition(reduceMotion ? .identity : .numericText())

                HStack(spacing: Theme.Spacing.xs) {
                    Text(card.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let delta = card.delta {
                        Text("\(delta.isPositive ? "↑" : "↓") \(delta.value)")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(delta.isPositive ? .green : .red)
                    }
                }
            }

            Spacer(minLength: 0)

            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(
            isHovered && onNavigate != nil
                ? Color(nsColor: .separatorColor).opacity(0.05)
                : .clear
        )
        .background(Theme.cardBackground)
        .clipShape(.rect(cornerRadius: Theme.Radius.md))
        .shadow(color: .black.opacity(0.06), radius: 2, y: 1)
        .onHover { isHovered = $0 }
        .contextMenu {
            if let onNavigate {
                Button {
                    onNavigate()
                } label: {
                    Label("Go to Section", systemImage: "arrow.right.circle")
                }
            }
        }
    }
}
