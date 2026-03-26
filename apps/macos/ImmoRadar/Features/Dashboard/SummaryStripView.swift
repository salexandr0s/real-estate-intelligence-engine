import SwiftUI

/// Flat summary metric strip — icon + number + label, no card chrome.
struct SummaryStripView: View {
    let cards: [DashboardViewModel.SummaryCard]
    var onCardNavigate: ((String) -> Void)?

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 160), spacing: Theme.Spacing.lg)],
            alignment: .leading,
            spacing: Theme.Spacing.lg
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

// MARK: - Single Metric

private struct SummaryMetric: View {
    let card: DashboardViewModel.SummaryCard
    var onNavigate: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovered = false

    var body: some View {
        Button {
            onNavigate?()
        } label: {
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
            }
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.xs)
            .background(
                isHovered && onNavigate != nil
                    ? Color(nsColor: .separatorColor).opacity(0.05)
                    : .clear,
                in: .rect(cornerRadius: Theme.Radius.sm)
            )
        }
        .buttonStyle(.plain)
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
        .init(id: "a", title: "Active Listings", value: "93", icon: "building.2.fill", color: .blue, delta: nil),
        .init(id: "b", title: "New This Week", value: "12", icon: "sparkles", color: .green, delta: .init(value: "+12 this week", isPositive: true)),
        .init(id: "c", title: "High Score (70+)", value: "36", icon: "star.fill", color: .orange, delta: nil),
        .init(id: "d", title: "Active Filters", value: "2", icon: "line.3.horizontal.decrease.circle.fill", color: .purple, delta: nil),
    ])
    .padding()
    .frame(width: 800)
}
