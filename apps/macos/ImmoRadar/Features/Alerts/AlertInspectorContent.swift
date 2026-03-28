import SwiftUI

/// Focused inspector content for alert triage.
struct AlertInspectorContent: View {
    let alert: Alert?
    var onMarkAsRead: (() -> Void)?
    var onDismiss: (() -> Void)?
    var onOpenListing: (() -> Void)?
    var onOpenFilters: (() -> Void)?

    var body: some View {
        if let alert {
            let presentation = AlertPresentation.make(for: alert)

            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    inspectorHeader(alert: alert, presentation: presentation)
                    inspectorSnapshot(alert: alert)

                    if let reasons = alert.matchReasons {
                        inspectorSection(title: "Match Reasons", systemImage: "line.3.horizontal.decrease.circle") {
                            AlertMatchReasonChips(reasons: reasons)
                        }
                    }

                    inspectorSection(title: "Alert Summary", systemImage: presentation.type.icon) {
                        Text(presentation.reasonSummary)
                            .font(.body)
                            .foregroundStyle(.primary)

                        if alert.body != presentation.reasonSummary {
                            Text(alert.body)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }

                    inspectorDetails(alert: alert)
                }
                .padding(Theme.Spacing.lg)
            }
        } else {
            ContentUnavailableView(
                "No Alert Selected",
                systemImage: "bell",
                description: Text("Select an alert to review its context and next action.")
            )
        }
    }

    private func inspectorHeader(alert: Alert, presentation: AlertPresentation) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                Label(presentation.type.title, systemImage: presentation.type.icon)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(presentation.type.tint)

                StatusBadge(
                    label: presentation.status.title,
                    color: presentation.status.tint,
                    icon: presentation.status.icon
                )

                Spacer()

                Text(PriceFormatter.formatDateTime(alert.matchedAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(alert.listing?.title ?? alert.title)
                .font(.title3.weight(.semibold))
                .lineLimit(3)

            HStack(spacing: Theme.Spacing.sm) {
                if let sourceCode = alert.listing?.sourceCode {
                    HStack(spacing: Theme.Spacing.xxs) {
                        SourceLogo(sourceCode: sourceCode, size: 14)
                        Text(alert.listing?.sourceDisplayName ?? sourceCode.capitalized)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                if let location = alert.listing?.alertLocationLabel {
                    Label(location, systemImage: "mappin")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let filterName = alert.filterName {
                    Label(filterName, systemImage: "line.3.horizontal.decrease.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let listingId = alert.listingId {
                    Text("#\(listingId)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.tertiary)
                }
            }

            HStack(spacing: Theme.Spacing.sm) {
                if let onMarkAsRead, alert.status == .unread {
                    Button("Mark Read", systemImage: "envelope.open", action: onMarkAsRead)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                }

                if let onDismiss, alert.status != .dismissed {
                    Button(role: .destructive, action: onDismiss) {
                        Label("Dismiss", systemImage: "archivebox")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }

                if let onOpenListing, alert.listingId != nil {
                    Button("Open Listing", systemImage: "arrow.right.circle", action: onOpenListing)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }

                if let onOpenFilters, alert.filterName != nil {
                    Button("Open Filters", systemImage: "line.3.horizontal.decrease.circle", action: onOpenFilters)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
        }
        .cardStyle(.subtle, padding: Theme.Spacing.lg, cornerRadius: Theme.Radius.lg)
    }

    @ViewBuilder
    private func inspectorSnapshot(alert: Alert) -> some View {
        if let listing = alert.listing {
            inspectorSection(title: "Listing Snapshot", systemImage: "building.2") {
                HStack(alignment: .top, spacing: Theme.Spacing.md) {
                    ScoreIndicator(score: listing.currentScore ?? 0, size: .compact)

                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        HStack(spacing: Theme.Spacing.sm) {
                            Text(PriceFormatter.format(eur: listing.listPriceEur))
                                .font(.headline.monospacedDigit())

                            if let pct = listing.lastPriceChangePct, pct != 0 {
                                PriceTrendBadge(changePct: pct)
                            }
                        }

                        HStack(spacing: Theme.Spacing.sm) {
                            Label(listing.districtName ?? listing.city, systemImage: "mappin")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            if let area = listing.livingAreaSqm {
                                Text(PriceFormatter.formatArea(area))
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }

                            if let rooms = listing.rooms {
                                Text("\(PriceFormatter.formatRooms(rooms)) rooms")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    Spacer(minLength: 0)
                }
            }
        }
    }

    private func inspectorDetails(alert: Alert) -> some View {
        inspectorSection(title: "Details", systemImage: "info.circle") {
            InspectorDetailRow(label: "Status", value: AlertPresentation.make(for: alert).status.title)
            InspectorDetailRow(label: "Matched", value: PriceFormatter.formatDateTime(alert.matchedAt))

            if let source = alert.listing?.sourceDisplayName {
                InspectorDetailRow(label: "Source", value: source)
            }

            if let location = alert.listing?.alertLocationLabel {
                InspectorDetailRow(label: "Location", value: location)
            }

            if let filterName = alert.filterName {
                InspectorDetailRow(label: "Filter", value: filterName)
            }

            if let listingId = alert.listingId {
                InspectorDetailRow(label: "Listing ID", value: "#\(listingId)")
            }
        }
    }

    private func inspectorSection<Content: View>(
        title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            content()
        }
        .cardStyle(.subtle, padding: Theme.Spacing.lg, cornerRadius: Theme.Radius.lg)
    }
}
