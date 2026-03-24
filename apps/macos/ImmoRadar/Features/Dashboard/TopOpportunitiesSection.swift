import SwiftUI

/// Compact list of top-scoring listings.
struct TopOpportunitiesSection: View {
    let listings: [Listing]
    let districtComparison: [DistrictComparison]
    var onListingTap: ((Int) -> Void)?

    private func avgPpsqm(for districtNo: Int?) -> Double? {
        guard let d = districtNo else { return nil }
        return districtComparison.first(where: { $0.districtNo == d })?.avgPricePerSqm
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Label("Top Opportunities", systemImage: "star.fill")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(listings.count) scored 70+")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if listings.isEmpty {
                Text("No high-scoring listings")
                    .font(.caption).foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, minHeight: 80)
            } else {
                VStack(spacing: 0) {
                    let displayed = Array(listings.prefix(7))
                    ForEach(Array(displayed.enumerated()), id: \.element.id) { index, listing in
                        OpportunityCard(
                            listing: listing,
                            districtAvgPpsqm: avgPpsqm(for: listing.districtNo),
                            onTap: { onListingTap?(listing.id) }
                        )
                        if index < displayed.count - 1 {
                            Divider().padding(.leading, 40)
                        }
                    }
                }
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.cardBackground)
        .clipShape(.rect(cornerRadius: Theme.Radius.lg))
        .shadow(color: .black.opacity(0.06), radius: 2, y: 1)
    }
}
