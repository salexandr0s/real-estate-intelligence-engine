import SwiftUI

/// "For You" section — listings grouped by the user's active filters.
struct ForYouSection: View {
    let activeFilters: [Filter]
    let filterListings: [Int: [Listing]]
    let filterLoadingStates: [Int: Bool]
    let isLoading: Bool
    var onListingTap: ((Int) -> Void)?
    var onNavigateToFilters: (() -> Void)?
    var onNavigateToListings: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
            Text("For You")
                .font(.title3)
                .adaptiveFontWeight(.semibold)

            if activeFilters.isEmpty && !isLoading {
                ForYouEmptyState(onSetUpFilters: onNavigateToFilters)
            } else {
                ForEach(activeFilters) { filter in
                    ForYouFilterGroup(
                        filter: filter,
                        listings: filterListings[filter.id] ?? [],
                        isLoading: filterLoadingStates[filter.id] ?? false,
                        onListingTap: onListingTap,
                        onShowAll: onNavigateToListings
                    )
                }
            }
        }
    }
}

// MARK: - Filter Group

/// A single filter's matched listings, shown as a card with header and listing rows.
struct ForYouFilterGroup: View {
    let filter: Filter
    let listings: [Listing]
    let isLoading: Bool
    var onListingTap: ((Int) -> Void)?
    var onShowAll: (() -> Void)?

    @State private var hoveredListingId: Int?

    private var displayedListings: [Listing] {
        Array(
            listings
                .sorted { ($0.currentScore ?? 0) > ($1.currentScore ?? 0) }
                .prefix(5)
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            // Header
            HStack {
                Text(filter.name)
                    .font(.subheadline)
                    .adaptiveFontWeight(.semibold)

                if isLoading {
                    ProgressView()
                        .controlSize(.mini)
                }

                Spacer()

                if listings.count > 5 {
                    Button {
                        onShowAll?()
                    } label: {
                        Text("Show all \(listings.count)")
                            .font(.caption)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.accentColor)
                }
            }

            // Listings
            if displayedListings.isEmpty && !isLoading {
                Text("No matches")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, Theme.Spacing.sm)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(displayedListings.enumerated()), id: \.element.id) { index, listing in
                        ForYouListingCard(
                            listing: listing,
                            onTap: { onListingTap?(listing.id) },
                            isHovered: hoveredListingId == listing.id
                        )
                        .onHover { isHovered in
                            hoveredListingId = isHovered ? listing.id : nil
                        }

                        if index < displayedListings.count - 1 {
                            Divider()
                                .padding(.leading, 40)
                        }
                    }
                }
            }
        }
        .cardStyle(padding: Theme.Spacing.md)
    }
}

// MARK: - Empty State

private struct ForYouEmptyState: View {
    var onSetUpFilters: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label("No Active Filters", systemImage: "line.3.horizontal.decrease.circle")
        } description: {
            Text("Set up filters to see matching properties here.")
        } actions: {
            if let onSetUpFilters {
                Button("Set Up Filters") {
                    onSetUpFilters()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

#Preview {
    ForYouSection(
        activeFilters: Array(Filter.samples.filter(\.isActive)),
        filterListings: [1: Array(Listing.samples.prefix(3))],
        filterLoadingStates: [:],
        isLoading: false
    )
    .padding()
    .frame(width: 600)
}
