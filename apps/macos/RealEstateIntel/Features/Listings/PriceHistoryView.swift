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

    /// Only show versions with price changes or first listing.
    private var priceRelevantVersions: [PriceVersion] {
        versions.filter { v in
            guard let reason = v.reason else { return true }
            return reason == "first_seen" || reason == "price_change" || reason.isEmpty
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Price History")
                .font(.headline)

            if priceRelevantVersions.count <= 1 {
                SingleVersionContent(version: priceRelevantVersions.first)
            } else {
                CompactTimelineContent(versions: priceRelevantVersions)
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

// MARK: - Compact Timeline

private struct CompactTimelineContent: View {
    let versions: [PriceVersion]

    private var sortedVersions: [PriceVersion] {
        versions.sorted { $0.date > $1.date }
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(sortedVersions.enumerated()), id: \.element.id) { index, version in
                let previousVersion = index + 1 < sortedVersions.count
                    ? sortedVersions[index + 1]
                    : nil

                HStack(spacing: Theme.Spacing.sm) {
                    Text(PriceFormatter.formatDate(version.date))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 80, alignment: .leading)

                    Text(PriceFormatter.format(eur: version.priceEur))
                        .font(.subheadline.monospacedDigit())
                        .fontWeight(index == 0 ? .semibold : .regular)

                    Spacer()

                    if let prev = previousVersion {
                        let change = version.priceEur - prev.priceEur
                        if change != 0 {
                            HStack(spacing: Theme.Spacing.xxs) {
                                Image(systemName: change < 0 ? "arrow.down.right" : "arrow.up.right")
                                    .font(.caption2)
                                Text(PriceFormatter.format(eur: abs(change)))
                                    .font(.caption.monospacedDigit())
                            }
                            .foregroundStyle(change < 0 ? .green : .red)
                        }
                    }

                    if index == 0 {
                        Text("Current")
                            .font(.caption2.bold())
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, Theme.Spacing.xs)

                if index < sortedVersions.count - 1 {
                    Divider()
                }
            }
        }
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
