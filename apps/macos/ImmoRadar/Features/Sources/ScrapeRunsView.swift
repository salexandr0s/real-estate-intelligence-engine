import SwiftUI

/// Detail view showing recent scrape runs with success/failure badges and stats.
struct ScrapeRunsView: View {
    let runs: [ScrapeRun]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Recent Scrape Runs")
                .font(.headline)

            if runs.isEmpty {
                Text("No scrape runs yet")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, Theme.Spacing.lg)
            } else {
                ForEach(runs) { run in
                    ScrapeRunRow(run: run)
                    if run.id != runs.last?.id {
                        Divider()
                    }
                }
            }
        }
    }
}

private struct ScrapeRunRow: View {
    let run: ScrapeRun

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Status badge
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)

            // Timestamp
            VStack(alignment: .leading, spacing: 2) {
                if let started = run.parsedStartedAt {
                    Text(started, style: .relative)
                        .font(.caption)
                }
                Text(run.status)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(width: 90, alignment: .leading)

            // Stats
            HStack(spacing: Theme.Spacing.md) {
                StatPill(label: "Pages", value: "\(run.pagesFetched)")
                StatPill(label: "Found", value: "\(run.listingsDiscovered)")
                StatPill(label: "2xx", value: "\(run.http2xx)")
                if run.http4xx > 0 {
                    StatPill(label: "4xx", value: "\(run.http4xx)", color: .orange)
                }
                if run.http5xx > 0 {
                    StatPill(label: "5xx", value: "\(run.http5xx)", color: .red)
                }
                if run.captchaCount > 0 {
                    StatPill(label: "CAPTCHA", value: "\(run.captchaCount)", color: .purple)
                }
            }

            Spacer()

            // Error message
            if let error = run.errorMessage {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .lineLimit(1)
                    .frame(maxWidth: 200)
            }
        }
        .padding(.vertical, 2)
    }

    private var statusColor: Color {
        switch run.status {
        case "succeeded": .green
        case "partial": .orange
        case "failed": .red
        case "rate_limited": .yellow
        default: .gray
        }
    }
}

private struct StatPill: View {
    let label: String
    let value: String
    var color: Color = .secondary

    var body: some View {
        VStack(spacing: 1) {
            Text(value)
                .font(.caption.monospacedDigit().bold())
                .foregroundStyle(color)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }
}
