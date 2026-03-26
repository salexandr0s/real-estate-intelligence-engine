import SwiftUI

/// Ranked queue of the strongest live matches across active filters.
struct TopOpportunitiesSection: View {
    let listings: [Listing]
    let totalMatches: Int
    var onListingTap: ((Int) -> Void)?

    @State private var hoveredListingId: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("Investor queue")
                        .font(.title3)
                        .adaptiveFontWeight(.semibold)

                    Text("Highest-scoring current matches across your active filters.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: Theme.Spacing.md)

                Text("\(totalMatches) live matches")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, Theme.Spacing.sm)
                    .padding(.vertical, 6)
                    .background(Color.secondary.opacity(0.08), in: Capsule())
            }

            Divider()

            if listings.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("No ranked opportunities yet")
                        .font(.subheadline)
                        .adaptiveFontWeight(.medium)
                    Text("As active filters start returning matches, the strongest listings will surface here first.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 176, alignment: .leading)
            } else {
                VStack(spacing: Theme.Spacing.xs) {
                    ForEach(Array(listings.enumerated()), id: \.element.id) { index, listing in
                        OpportunityCard(
                            listing: listing,
                            rank: index + 1,
                            onTap: { onListingTap?(listing.id) },
                            isHovered: hoveredListingId == listing.id
                        )
                        .onHover { isHovered in
                            hoveredListingId = isHovered ? listing.id : nil
                        }

                        if index < listings.count - 1 {
                            Divider()
                                .padding(.leading, 68)
                        }
                    }
                }
            }
        }
        .dashboardPanelStyle(tint: .blue, elevated: true)
    }
}
