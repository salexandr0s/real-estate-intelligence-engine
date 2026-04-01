import SwiftUI

/// Detail view showing recent scrape runs with operational stats.
struct ScrapeRunsView: View {
    let runs: [ScrapeRun]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Recent Runs")
                .font(.subheadline.weight(.semibold))

            if runs.isEmpty {
                Text("No recent scrape runs yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, Theme.Spacing.md)
            } else {
                VStack(spacing: 0) {
                    ForEach(runs) { run in
                        ScrapeRunRow(run: run)
                            .padding(.vertical, Theme.Spacing.sm)
                        if run.id != runs.last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
    }
}

private struct ScrapeRunRow: View {
    let run: ScrapeRun

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                StatusBadge(label: statusTitle, color: statusColor, icon: statusIcon)

                if let started = run.parsedStartedAt {
                    Text(PriceFormatter.relativeDate(started))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text(run.triggerType.replacing("_", with: " ").capitalized)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            HStack(spacing: Theme.Spacing.md) {
                RunStat(label: "Pages", value: "\(run.pagesFetched)")
                RunStat(label: "Found", value: "\(run.listingsDiscovered)")
                RunStat(label: "2xx", value: "\(run.http2xx)")

                if run.retryCount > 0 {
                    RunStat(label: "Retries", value: "\(run.retryCount)", tint: .scoreAverage)
                }
                if run.http4xx > 0 {
                    RunStat(label: "4xx", value: "\(run.http4xx)", tint: .scoreAverage)
                }
                if run.http5xx > 0 {
                    RunStat(label: "5xx", value: "\(run.http5xx)", tint: .scorePoor)
                }
                if run.captchaCount > 0 {
                    RunStat(label: "Captcha", value: "\(run.captchaCount)", tint: .scorePoor)
                }
            }

            if let error = run.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }

    private var statusTitle: String {
        run.status.replacing("_", with: " ").capitalized
    }

    private var statusIcon: String {
        switch run.status {
        case "succeeded": "checkmark.circle.fill"
        case "partial": "exclamationmark.circle.fill"
        case "failed": "xmark.circle.fill"
        case "rate_limited": "tortoise.fill"
        default: "circle.fill"
        }
    }

    private var statusColor: Color {
        switch run.status {
        case "succeeded": .scoreGood
        case "partial", "rate_limited": .scoreAverage
        case "failed": .scorePoor
        default: .secondary
        }
    }
}

private struct RunStat: View {
    let label: String
    let value: String
    var tint: Color = .primary

    var body: some View {
        HStack(spacing: 4) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(tint)
        }
    }
}
