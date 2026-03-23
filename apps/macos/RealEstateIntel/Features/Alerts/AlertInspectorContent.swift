import SwiftUI

/// Inspector content showing alert detail or empty state.
struct AlertInspectorContent: View {
    let alert: Alert?

    var body: some View {
        if let alert {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                    // Header
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        HStack(spacing: Theme.Spacing.sm) {
                            Image(systemName: alert.alertType.iconName)
                                .foregroundStyle(Theme.alertColor(for: alert.alertType))
                                .font(.title2)
                                .accessibilityHidden(true)

                            Text(alert.alertType.displayName)
                                .font(.headline)
                                .foregroundStyle(Theme.alertColor(for: alert.alertType))
                        }

                        Text(alert.title)
                            .font(.title3)
                            .fontWeight(.semibold)
                    }

                    Divider()

                    // Body
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Details")
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundStyle(.secondary)

                        Text(alert.body)
                            .font(.body)
                    }

                    // Metadata
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        Text("Info")
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundStyle(.secondary)

                        InspectorDetailRow(label: "Status", value: alert.status.displayName)
                        InspectorDetailRow(label: "Matched", value: PriceFormatter.formatDateTime(alert.matchedAt))

                        if let filterName = alert.filterName {
                            InspectorDetailRow(label: "Filter", value: filterName)
                        }

                        if let listingId = alert.listingId {
                            InspectorDetailRow(label: "Listing ID", value: "#\(listingId)")
                        }
                    }

                    // Match reasons
                    if let reasons = alert.matchReasons {
                        MatchReasonsView(reasons: reasons)
                    }

                    // Linked listing hint
                    if let listingId = alert.listingId {
                        Divider()

                        Text("Listing #\(listingId) — view in Listings tab")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(Theme.Spacing.lg)
            }
        } else {
            ContentUnavailableView(
                "No Alert Selected",
                systemImage: "bell",
                description: Text("Select an alert to view its details.")
            )
        }
    }
}

// MARK: - Match Reasons View

private struct MatchReasonsView: View {
    let reasons: AlertMatchReasons

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Match Reasons")
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)

            if let keywords = reasons.matchedKeywords, !keywords.isEmpty {
                HStack(spacing: Theme.Spacing.xs) {
                    Text("Keywords:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    FlowLayout(spacing: Theme.Spacing.xs) {
                        ForEach(keywords, id: \.self) { keyword in
                            Text(keyword)
                                .font(.caption2)
                                .padding(.horizontal, Theme.Spacing.sm)
                                .padding(.vertical, Theme.Spacing.xxs)
                                .background(Color.accentColor.opacity(0.12))
                                .clipShape(Capsule())
                        }
                    }
                }
            }

            if reasons.districtMatch == true {
                HStack(spacing: Theme.Spacing.xs) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.caption)
                    Text("District match")
                        .font(.caption)
                }
            }

            if let thresholds = reasons.thresholdsMet {
                HStack(spacing: Theme.Spacing.sm) {
                    if thresholds.price == true {
                        thresholdBadge("Price")
                    }
                    if thresholds.area == true {
                        thresholdBadge("Area")
                    }
                    if thresholds.rooms == true {
                        thresholdBadge("Rooms")
                    }
                    if thresholds.score == true {
                        thresholdBadge("Score")
                    }
                }
            }
        }
    }

    private func thresholdBadge(_ label: String) -> some View {
        HStack(spacing: Theme.Spacing.xxs) {
            Image(systemName: "checkmark")
                .font(.system(size: 8, weight: .bold))
            Text(label)
                .font(.caption2)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xxs)
        .background(Color.green.opacity(0.12))
        .clipShape(Capsule())
    }
}

// MARK: - Inspector Detail Row

private struct InspectorDetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 80, alignment: .leading)
            Text(value)
                .font(.caption)
        }
    }
}
