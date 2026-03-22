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

                        if alert.listingId != nil {
                            InspectorDetailRow(label: "Listing ID", value: "#\(alert.listingId!)")
                        }
                    }

                    // Linked listing hint
                    if alert.listingId != nil {
                        Divider()

                        Text("Listing #\(alert.listingId!) — view in Listings tab")
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

// MARK: - Inspector Detail Row

struct InspectorDetailRow: View {
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
