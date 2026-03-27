import SwiftUI

/// Quiet dashboard metric rail used as supporting context inside the briefing flow.
struct SummaryStripView: View {
    let cards: [DashboardViewModel.SummaryCard]
    var onCardNavigate: ((String) -> Void)?

    var body: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: Theme.Spacing.sm),
                GridItem(.flexible(), spacing: Theme.Spacing.sm),
            ],
            alignment: .leading,
            spacing: Theme.Spacing.sm
        ) {
            ForEach(cards) { card in
                SummaryMetric(
                    card: card,
                    onNavigate: onCardNavigate.map { callback in { callback(card.id) } }
                )
            }
        }
    }
}

private struct SummaryMetric: View {
    let card: DashboardViewModel.SummaryCard
    var onNavigate: (() -> Void)?
    var minHeight: CGFloat = 92

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovered = false

    var body: some View {
        Button {
            onNavigate?()
        } label: {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                HStack(alignment: .top) {
                    ZStack {
                        Circle()
                            .fill(Theme.Dashboard.iconChipBackground(for: card.tone))
                            .frame(width: 28, height: 28)

                        Image(systemName: card.icon)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Theme.Dashboard.iconTint(for: card.tone))
                    }

                    Spacer(minLength: Theme.Spacing.sm)

                    if let delta = card.delta {
                        Label(delta.value, systemImage: delta.isPositive ? "arrow.up" : "arrow.down")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(Theme.Dashboard.deltaColor(isPositive: delta.isPositive))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 4)
                            .background(Color.secondary.opacity(0.08), in: Capsule())
                    }
                }

                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(card.value)
                        .font(.title3)
                        .bold()
                        .fontDesign(.rounded)
                        .foregroundStyle(.primary)
                        .contentTransition(reduceMotion ? .identity : .numericText())

                    Text(card.title)
                        .font(.caption)
                        .adaptiveFontWeight(.medium)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .topLeading)
            .dashboardPanelStyle(
                padding: Theme.Spacing.md,
                tone: card.tone,
                elevated: false
            )
            .scaleEffect(isHovered && onNavigate != nil && !reduceMotion ? 1.006 : 1)
            .offset(y: isHovered && onNavigate != nil && !reduceMotion ? -1 : 0)
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.14), value: isHovered)
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
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

#Preview {
    SummaryStripView(cards: [
        .init(id: "a", title: "Active Listings", value: "93", icon: "building.2.fill", tone: .neutral, delta: .init(value: "+12 this week", isPositive: true)),
        .init(id: "b", title: "New This Week", value: "12", icon: "sparkles", tone: .accent, delta: nil),
        .init(id: "c", title: "High Score (70+)", value: "36", icon: "star.fill", tone: .score, delta: .init(value: "Avg 58", isPositive: true)),
        .init(id: "d", title: "Active Filters", value: "2", icon: "line.3.horizontal.decrease.circle.fill", tone: .accent, delta: .init(value: "1 with matches", isPositive: true)),
        .init(id: "e", title: "Unread Alerts", value: "5", icon: "bell.badge.fill", tone: .alert, delta: nil),
    ])
    .padding()
    .frame(width: 420)
}
