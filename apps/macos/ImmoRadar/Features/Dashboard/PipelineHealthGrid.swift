import SwiftUI

/// Source health panel with success rate bars and error context.
struct PipelineHealthGrid: View {
    let sources: [Source]
    var onSourceTap: ((Int) -> Void)?

    @State private var hoveredSourceId: Int?

    private var healthyCount: Int {
        sources.count(where: { $0.healthStatus == .healthy })
    }

    private var activeCount: Int {
        sources.count(where: { $0.isActive })
    }

    /// Sort: blocked/degraded first, then unknown, then healthy, then disabled.
    private var sortedSources: [Source] {
        sources.sorted { a, b in
            a.healthStatus.sortOrder < b.healthStatus.sortOrder
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Label("Sources", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.subheadline)
                    .adaptiveFontWeight(.semibold)
                Spacer()
                Text("\(healthyCount)/\(activeCount) healthy")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if sources.isEmpty {
                Text("No sources")
                    .font(.caption).foregroundStyle(.tertiary)
            } else {
                VStack(spacing: Theme.Spacing.xs) {
                    ForEach(sortedSources, id: \.id) { source in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: Theme.Spacing.sm) {
                                Circle()
                                    .fill(Theme.healthColor(for: source.healthStatus))
                                    .frame(width: 6, height: 6)

                                Text(source.name)
                                    .font(.caption)
                                    .lineLimit(1)

                                Spacer(minLength: Theme.Spacing.xs)

                                // Success rate mini-bar
                                SuccessRateBar(
                                    rate: source.successRatePct,
                                    color: Theme.healthColor(for: source.healthStatus)
                                )

                                if let lastRun = source.lastSuccessfulRun {
                                    Text(PriceFormatter.relativeDate(lastRun))
                                        .font(Theme.chartAxisFont)
                                        .foregroundStyle(.tertiary)
                                        .frame(width: 36, alignment: .trailing)
                                }
                            }

                            // Error summary for degraded/blocked sources
                            if let error = source.lastErrorSummary,
                               source.healthStatus == .degraded || source.healthStatus == .blocked {
                                Text(error)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(1)
                                    .padding(.leading, 14)
                            }
                        }
                        .padding(.vertical, Theme.Spacing.xxs)
                        .padding(.horizontal, Theme.Spacing.xs)
                        .background(
                            hoveredSourceId == source.id
                                ? Color(nsColor: .separatorColor).opacity(0.06)
                                : .clear,
                            in: .rect(cornerRadius: Theme.Radius.sm)
                        )
                        .onHover { isHovered in
                            hoveredSourceId = isHovered ? source.id : nil
                        }
                        .accessibilityElement(children: .combine)
                        .contextMenu {
                            Button {
                                onSourceTap?(source.id)
                            } label: {
                                Label("View Source", systemImage: "antenna.radiowaves.left.and.right")
                            }
                        }
                    }
                }
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.cardBackground)
        .clipShape(.rect(cornerRadius: Theme.Radius.lg))
    }
}

/// Tiny horizontal bar showing success rate percentage.
private struct SuccessRateBar: View {
    let rate: Double
    let color: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(color.opacity(0.15))
                RoundedRectangle(cornerRadius: 2)
                    .fill(color)
                    .frame(width: max(0, geo.size.width * rate / 100))
            }
        }
        .frame(width: 48, height: 4)
        .accessibilityLabel("\(Int(rate))% success rate")
    }
}
