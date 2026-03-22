import SwiftUI

/// Badge showing cross-source availability: "Also on: willhaben, immoscout"
struct CrossSourceBadge: View {
    let cluster: ListingCluster
    let currentListingId: Int

    private var otherSources: [String] {
        cluster.members
            .filter { $0.listingId != currentListingId }
            .map(\.sourceCode)
    }

    var body: some View {
        if !otherSources.isEmpty {
            HStack(spacing: Theme.Spacing.xs) {
                Image(systemName: "link")
                    .font(.caption2)
                    .foregroundStyle(.blue)
                Text("Also on: \(otherSources.joined(separator: ", "))")
                    .font(.caption2)
                    .foregroundStyle(.blue)
            }
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, 2)
            .background(Color.blue.opacity(0.08))
            .clipShape(Capsule())
        }
    }
}
