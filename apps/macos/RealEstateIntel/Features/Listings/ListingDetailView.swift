import SwiftUI

/// Detail view for a single listing, shown in the inspector pane.
struct ListingDetailView: View {
    let listing: Listing
    @State private var explanation: ScoreExplanation? = Listing.sampleExplanation

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                headerSection
                Divider()
                scoreSection
                Divider()
                detailsSection
                Divider()
                locationSection
                Divider()
                priceHistoryPlaceholder
                Divider()
                mapPlaceholder
                Divider()
                actionsSection
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                StatusBadge(listingStatus: listing.listingStatus)
                Spacer()
                Text(listing.sourceCode)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.1), in: Capsule())
            }

            Text(listing.title)
                .font(.title3.bold())
                .fixedSize(horizontal: false, vertical: true)

            Text(PriceFormatter.format(eur: listing.listPriceEur))
                .font(.title2.bold().monospacedDigit())
                .foregroundStyle(.blue)

            HStack(spacing: Theme.Spacing.lg) {
                Label(PriceFormatter.formatArea(listing.livingAreaSqm), systemImage: "ruler")
                    .font(.subheadline)
                Label("\(listing.rooms) rooms", systemImage: "square.split.2x2")
                    .font(.subheadline)
                Label(
                    PriceFormatter.formatPerSqm(listing.pricePerSqmEur) + "/m\u{00B2}",
                    systemImage: "eurosign"
                )
                .font(.subheadline.monospacedDigit())
            }
            .foregroundStyle(.secondary)
        }
    }

    // MARK: - Score Section

    private var scoreSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Text("Score Analysis")
                    .font(.headline)
                Spacer()
                ScoreIndicator(score: listing.currentScore, size: .large)
            }

            Text(Theme.scoreLabel(for: listing.currentScore))
                .font(.subheadline.bold())
                .foregroundStyle(Theme.scoreColor(for: listing.currentScore))

            if let explanation {
                scoreBreakdown(explanation)
            }
        }
    }

    private func scoreBreakdown(_ exp: ScoreExplanation) -> some View {
        VStack(spacing: Theme.Spacing.sm) {
            scoreRow("District Price", value: exp.districtPriceScore)
            scoreRow("Undervaluation", value: exp.undervaluationScore)
            scoreRow("Keyword Signals", value: exp.keywordSignalScore)
            scoreRow("Time on Market", value: exp.timeOnMarketScore)
            scoreRow("Confidence", value: exp.confidenceScore)

            Divider()

            if !exp.matchedPositiveKeywords.isEmpty {
                HStack(alignment: .top) {
                    Text("Positive keywords:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(exp.matchedPositiveKeywords.joined(separator: ", "))
                        .font(.caption.bold())
                        .foregroundStyle(.green)
                }
            }

            if !exp.matchedNegativeKeywords.isEmpty {
                HStack(alignment: .top) {
                    Text("Negative keywords:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(exp.matchedNegativeKeywords.joined(separator: ", "))
                        .font(.caption.bold())
                        .foregroundStyle(.red)
                }
            }

            VStack(spacing: Theme.Spacing.xs) {
                HStack {
                    Text("District baseline")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(PriceFormatter.formatPerSqm(exp.districtBaselinePpsqmEur) + "/m\u{00B2}")
                        .font(.caption.monospacedDigit())
                }
                HStack {
                    Text("Discount to district")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(PriceFormatter.formatPercent(exp.discountToDistrictPct))
                        .font(.caption.monospacedDigit().bold())
                        .foregroundStyle(.green)
                }
                HStack {
                    Text("Discount to bucket")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(PriceFormatter.formatPercent(exp.discountToBucketPct))
                        .font(.caption.monospacedDigit().bold())
                        .foregroundStyle(.green)
                }
            }
        }
    }

    private func scoreRow(_ label: String, value: Double) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 120, alignment: .leading)
            ScoreBar(score: value)
        }
    }

    // MARK: - Details

    private var detailsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Details")
                .font(.headline)

            detailRow("Operation", value: listing.operationType.rawValue.capitalized)
            detailRow("Property Type", value: listing.propertyType.displayName)
            detailRow("Listing UID", value: String(listing.listingUid.prefix(8)) + "...")
            detailRow("First Seen", value: PriceFormatter.formatDateTime(listing.firstSeenAt))
            detailRow("Status", value: listing.listingStatus.rawValue.capitalized)
        }
    }

    private func detailRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline)
        }
    }

    // MARK: - Location

    private var locationSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Location")
                .font(.headline)

            detailRow("City", value: listing.city)
            detailRow("District", value: "\(listing.districtNo). \(listing.districtName)")
            detailRow("Postal Code", value: listing.postalCode)
        }
    }

    // MARK: - Placeholders

    private var priceHistoryPlaceholder: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Price History")
                .font(.headline)

            VStack(spacing: Theme.Spacing.sm) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.title)
                    .foregroundStyle(.quaternary)
                Text("Price history chart will appear here")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Text("when the backend provides historical data.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Spacing.xl)
            .background(Color.secondary.opacity(0.04))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        }
    }

    private var mapPlaceholder: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Map")
                .font(.headline)

            VStack(spacing: Theme.Spacing.sm) {
                Image(systemName: "map")
                    .font(.title)
                    .foregroundStyle(.quaternary)
                Text("Map view will appear here")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Text("when geolocation data is available.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 120)
            .background(Color.secondary.opacity(0.04))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        }
    }

    // MARK: - Actions

    private var actionsSection: some View {
        VStack(spacing: Theme.Spacing.sm) {
            Button {
                if let url = URL(string: listing.canonicalUrl) {
                    NSWorkspace.shared.open(url)
                }
            } label: {
                Label("Open in Browser", systemImage: "safari")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)

            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(listing.canonicalUrl, forType: .string)
            } label: {
                Label("Copy URL", systemImage: "doc.on.doc")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.bordered)
        }
    }
}

#Preview {
    ListingDetailView(listing: Listing.samples[0])
        .frame(width: 380, height: 900)
}
