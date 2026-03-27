import SwiftUI

struct ListingComparisonBlockView: View {
    let data: ListingComparisonData
    let onListingTap: (Int) -> Void

    private var candidateColumnWidth: CGFloat {
        switch data.listings.count {
        case 5: 110
        case 4: 124
        case 3: 144
        default: 168
        }
    }

    private var labelColumnWidth: CGFloat {
        data.listings.count >= 4 ? 132 : 144
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            header

            if !data.callouts.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Spacing.sm) {
                        ForEach(data.callouts) { callout in
                            ComparisonVerdictStrip(callout: callout, onListingTap: onListingTap)
                        }
                    }
                    .padding(.vertical, 1)
                }
            }

            comparisonMatrix
        }
        .copilotArtifactCard(padding: Theme.Spacing.md)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Label("Listing comparison", systemImage: "rectangle.split.3x1")
                    .font(.subheadline.bold())
                Text("Scan candidate economics, score quality, and district context without leaving the workspace.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(data.listings.count) candidates")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    private var comparisonMatrix: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text("Verdict grid")
                        .font(.caption.bold())
                    Text("Tap a candidate to inspect it.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(width: labelColumnWidth, alignment: .leading)

                ForEach(data.listings) { listing in
                    Button {
                        onListingTap(listing.id)
                    } label: {
                        ComparisonCandidateHeader(listing: listing, width: candidateColumnWidth)
                    }
                    .buttonStyle(.plain)
                }
            }

            ForEach(data.sections) { section in
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    HStack(spacing: Theme.Spacing.sm) {
                        Text(section.title.uppercased())
                            .font(.caption2.bold())
                            .tracking(0.8)
                            .foregroundStyle(.secondary)
                        Rectangle()
                            .fill(Color(nsColor: .separatorColor).opacity(0.35))
                            .frame(height: 0.5)
                    }

                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        ForEach(section.metrics) { metric in
                            ComparisonMetricRow(
                                metric: metric,
                                labelColumnWidth: labelColumnWidth,
                                candidateColumnWidth: candidateColumnWidth
                            )
                        }
                    }
                    .copilotArtifactInset(padding: Theme.Spacing.sm)
                }
            }
        }
    }
}

private struct ComparisonCandidateHeader: View {
    let listing: CopilotListing
    let width: CGFloat

    private var districtLabel: String? {
        listing.districtName ?? listing.districtNo.map { "\($0). Bezirk" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                if let score = listing.score {
                    ScoreIndicator(score: score, size: .compact)
                }

                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text("#\(listing.id)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                    if let districtLabel {
                        Text(districtLabel)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 0)
            }

            Text(listing.title)
                .font(.caption.bold())
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(listing.priceEur.map(PriceFormatter.format(eur:)) ?? "—")
                    .font(.caption.monospacedDigit().bold())
                    .foregroundStyle(.primary)
                if let ppsqm = listing.pricePerSqmEur {
                    Text(PriceFormatter.formatPerSqm(ppsqm) + "/m²")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .frame(width: width, alignment: .leading)
        .copilotArtifactInset(padding: Theme.Spacing.sm)
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
    }
}

private struct ComparisonVerdictStrip: View {
    let callout: ComparisonCallout
    let onListingTap: (Int) -> Void

    var body: some View {
        Group {
            if let listingId = callout.listingId {
                Button {
                    onListingTap(listingId)
                } label: {
                    bodyContent
                }
                .buttonStyle(.plain)
            } else {
                bodyContent
            }
        }
    }

    private var bodyContent: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: iconName)
                .font(.caption.bold())
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(callout.label)
                    .font(.caption.bold())
                Text(callout.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.sm)
                .strokeBorder(tint.opacity(0.14), lineWidth: 0.5)
        }
    }

    private var tint: Color {
        switch callout.tone {
        case .positive: .green
        case .neutral: .accentColor
        case .caution: .orange
        }
    }

    private var iconName: String {
        switch callout.tone {
        case .positive: "checkmark.seal.fill"
        case .neutral: "scope"
        case .caution: "exclamationmark.triangle.fill"
        }
    }
}

private struct ComparisonMetricRow: View {
    let metric: ListingComparisonMetric
    let labelColumnWidth: CGFloat
    let candidateColumnWidth: CGFloat

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
            Text(metric.label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: labelColumnWidth, alignment: .leading)

            ForEach(metric.values) { value in
                ComparisonValueCell(value: value, width: candidateColumnWidth)
            }
        }
    }
}

private struct ComparisonValueCell: View {
    let value: ListingComparisonValue
    let width: CGFloat

    private var emphasisLabel: String? {
        switch value.emphasis {
        case .best: "Best"
        case .weakest: "Watch"
        case .neutral, .none: nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            if let emphasisLabel {
                Text(emphasisLabel)
                    .font(.caption2.bold())
                    .foregroundStyle(textColor)
            }

            Text(value.value ?? "—")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.primary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(width: width, alignment: .leading)
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(backgroundColor, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.sm)
                .strokeBorder(borderColor, lineWidth: 0.5)
        }
    }

    private var backgroundColor: Color {
        switch value.emphasis {
        case .best: Color.green.opacity(0.12)
        case .weakest: Color.orange.opacity(0.12)
        case .neutral, .none: Color(nsColor: .controlBackgroundColor)
        }
    }

    private var borderColor: Color {
        switch value.emphasis {
        case .best: Color.green.opacity(0.2)
        case .weakest: Color.orange.opacity(0.2)
        case .neutral, .none: Color(nsColor: .separatorColor).opacity(0.18)
        }
    }

    private var textColor: Color {
        switch value.emphasis {
        case .best: .green
        case .weakest: .orange
        case .neutral, .none: .secondary
        }
    }
}
