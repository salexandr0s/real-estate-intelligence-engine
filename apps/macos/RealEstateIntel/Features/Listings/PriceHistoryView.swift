import SwiftUI

/// A version entry representing a price snapshot at a point in time.
struct PriceVersion: Identifiable {
    let id = UUID()
    let date: Date
    let priceEur: Int
    let reason: String?
}

/// Timeline view showing price changes across listing versions.
struct PriceHistoryView: View {
    let versions: [PriceVersion]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Price History")
                .font(.headline)

            if versions.count <= 1 {
                SingleVersionContent(version: versions.first)
            } else {
                TimelineContent(versions: versions)
            }
        }
    }
}

// MARK: - Single Version

private struct SingleVersionContent: View {
    let version: PriceVersion?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            if let version {
                HStack(spacing: Theme.Spacing.sm) {
                    Image(systemName: "tag.fill")
                        .foregroundStyle(.secondary)
                        .font(.caption)
                    Text("Current: \(PriceFormatter.format(eur: version.priceEur))")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
            }

            Text("No price changes recorded")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }
}

// MARK: - Timeline

private struct TimelineContent: View {
    let versions: [PriceVersion]

    /// Versions sorted newest first for display.
    private var sortedVersions: [PriceVersion] {
        versions.sorted { $0.date > $1.date }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(sortedVersions.enumerated()), id: \.element.id) { index, version in
                let previousVersion = index + 1 < sortedVersions.count
                    ? sortedVersions[index + 1]
                    : nil

                TimelineRow(
                    version: version,
                    previousVersion: previousVersion,
                    isFirst: index == 0,
                    isLast: index == sortedVersions.count - 1
                )
            }
        }
    }
}

// MARK: - Timeline Row

private struct TimelineRow: View {
    let version: PriceVersion
    let previousVersion: PriceVersion?
    let isFirst: Bool
    let isLast: Bool

    private var priceChange: Int? {
        guard let previous = previousVersion else { return nil }
        return version.priceEur - previous.priceEur
    }

    private var isDecrease: Bool {
        guard let change = priceChange else { return false }
        return change < 0
    }

    private var isIncrease: Bool {
        guard let change = priceChange else { return false }
        return change > 0
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            // Date column
            VStack(alignment: .trailing, spacing: Theme.Spacing.xxs) {
                Text(PriceFormatter.formatDate(version.date))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .frame(width: 90, alignment: .trailing)

            // Timeline dot and line
            VStack(spacing: 0) {
                if !isFirst {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(width: 1, height: Theme.Spacing.sm)
                }

                Circle()
                    .fill(dotColor)
                    .frame(width: 8, height: 8)

                if !isLast {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(width: 1, height: Theme.Spacing.xl)
                }
            }

            // Price and change
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                HStack(spacing: Theme.Spacing.sm) {
                    Text(PriceFormatter.format(eur: version.priceEur))
                        .font(.subheadline)
                        .fontWeight(isFirst ? .semibold : .regular)
                        .monospacedDigit()

                    if let change = priceChange, change != 0 {
                        HStack(spacing: Theme.Spacing.xxs) {
                            Image(systemName: isDecrease
                                ? "arrow.down.right"
                                : "arrow.up.right")
                                .font(.caption2)
                            Text(PriceFormatter.format(eur: abs(change)))
                                .font(.caption)
                                .monospacedDigit()
                        }
                        .foregroundStyle(isDecrease ? .green : .red)
                    }
                }

                if let reason = version.reason, !reason.isEmpty {
                    Text(reason)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                if isFirst {
                    Text("Current")
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, Theme.Spacing.xxs)
    }

    private var dotColor: Color {
        if isFirst { return .accentColor }
        if isDecrease { return .green }
        if isIncrease { return .red }
        return .secondary
    }
}

// MARK: - Sample Data

extension PriceVersion {
    static let samples: [PriceVersion] = [
        PriceVersion(
            date: Calendar.current.date(byAdding: .day, value: -30, to: .now)!,
            priceEur: 320_000,
            reason: "Initial listing"
        ),
        PriceVersion(
            date: Calendar.current.date(byAdding: .day, value: -14, to: .now)!,
            priceEur: 305_000,
            reason: "Price reduction"
        ),
        PriceVersion(
            date: Calendar.current.date(byAdding: .day, value: -3, to: .now)!,
            priceEur: 299_000,
            reason: "Price reduction"
        ),
    ]
}

#Preview("Multiple versions") {
    PriceHistoryView(versions: PriceVersion.samples)
        .padding()
        .frame(width: 400)
}

#Preview("Single version") {
    PriceHistoryView(versions: [PriceVersion.samples[0]])
        .padding()
        .frame(width: 400)
}
