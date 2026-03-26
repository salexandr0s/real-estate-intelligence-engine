import SwiftUI

/// Dashboard KPI cluster — colorful metric cards with stronger hierarchy.
struct SummaryStripView: View {
    let cards: [DashboardViewModel.SummaryCard]
    var onCardNavigate: ((String) -> Void)?

    private var primaryCards: [DashboardViewModel.SummaryCard] {
        Array(cards.prefix(4))
    }

    private var secondaryCard: DashboardViewModel.SummaryCard? {
        cards.count > 4 ? cards.last : nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Dashboard.gridSpacing) {
            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: Theme.Dashboard.gridSpacing),
                    GridItem(.flexible(), spacing: Theme.Dashboard.gridSpacing),
                ],
                alignment: .leading,
                spacing: Theme.Dashboard.gridSpacing
            ) {
                ForEach(primaryCards) { card in
                    SummaryMetric(
                        card: card,
                        onNavigate: onCardNavigate.map { callback in { callback(card.id) } }
                    )
                }
            }

            if let secondaryCard {
                SummaryMetric(
                    card: secondaryCard,
                    onNavigate: onCardNavigate.map { callback in { callback(secondaryCard.id) } },
                    minHeight: 118
                )
            }
        }
    }
}

private struct SummaryMetric: View {
    let card: DashboardViewModel.SummaryCard
    var onNavigate: (() -> Void)?
    var minHeight: CGFloat = 128

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovered = false

    var body: some View {
        Button {
            onNavigate?()
        } label: {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                HStack(alignment: .top) {
                    ZStack {
                        Circle()
                            .fill(.white.opacity(0.12))
                            .frame(width: 34, height: 34)

                        Image(systemName: card.icon)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(card.color)
                    }

                    Spacer(minLength: Theme.Spacing.md)

                    if let delta = card.delta {
                        Text(delta.value)
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(delta.isPositive ? Color.green : Color.red)
                            .padding(.horizontal, Theme.Spacing.sm)
                            .padding(.vertical, 5)
                            .background(.white.opacity(0.08), in: Capsule())
                    }
                }

                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(card.value)
                        .font(.system(size: 30, weight: .bold, design: .rounded))
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
                padding: Theme.Spacing.lg,
                tint: card.color,
                elevated: true
            )
            .scaleEffect(isHovered && onNavigate != nil && !reduceMotion ? 1.01 : 1)
            .offset(y: isHovered && onNavigate != nil && !reduceMotion ? -2 : 0)
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
        .init(id: "a", title: "Active Listings", value: "93", icon: "building.2.fill", color: .blue, delta: .init(value: "+12 this week", isPositive: true)),
        .init(id: "b", title: "New This Week", value: "12", icon: "sparkles", color: .green, delta: nil),
        .init(id: "c", title: "High Score (70+)", value: "36", icon: "star.fill", color: .orange, delta: .init(value: "Avg 58", isPositive: true)),
        .init(id: "d", title: "Active Filters", value: "2", icon: "line.3.horizontal.decrease.circle.fill", color: .purple, delta: .init(value: "1 with matches", isPositive: true)),
        .init(id: "e", title: "Unread Alerts", value: "5", icon: "bell.badge.fill", color: .red, delta: nil),
    ])
    .padding()
    .frame(width: 420)
}
