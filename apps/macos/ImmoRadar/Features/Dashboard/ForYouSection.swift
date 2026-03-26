import SwiftUI

/// Tracked filter overview — matched listings grouped into secondary dashboard panels.
struct ForYouSection: View {
    let activeFilters: [Filter]
    let filterListings: [Int: [Listing]]
    let filterLoadingStates: [Int: Bool]
    let isLoading: Bool
    var onListingTap: ((Int) -> Void)?
    var onNavigateToFilters: (() -> Void)?
    var onNavigateToListings: (() -> Void)?

    private let columns = [
        GridItem(.adaptive(minimum: Theme.Dashboard.trackedFilterMinWidth, maximum: 520), spacing: Theme.Dashboard.gridSpacing, alignment: .top),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("Tracked filters")
                        .font(.title3)
                        .adaptiveFontWeight(.semibold)

                    Text("Filter-level detail, kept secondary to the live overview above.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: Theme.Spacing.md)

                if let onNavigateToFilters {
                    Button("Manage Filters", action: onNavigateToFilters)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }

            if activeFilters.isEmpty && !isLoading {
                ForYouEmptyState(onSetUpFilters: onNavigateToFilters)
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Dashboard.gridSpacing) {
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
}

// MARK: - Filter Group

/// A single filter's matched listings, shown as a compact panel.
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
                .prefix(4)
        )
    }

    private var accentColor: Color {
        filter.filterKind == .alert ? .purple : .blue
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(filter.name)
                        .font(.subheadline)
                        .adaptiveFontWeight(.semibold)
                        .lineLimit(2)

                    Label {
                        Text(filter.filterKind == .alert ? "Alert filter" : "Saved filter")
                    } icon: {
                        Circle()
                            .fill(filter.filterKind == .alert ? Color.purple : Color.blue)
                            .frame(width: 6, height: 6)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                Spacer(minLength: Theme.Spacing.md)

                HStack(spacing: Theme.Spacing.xs) {
                    if isLoading {
                        ProgressView()
                            .controlSize(.mini)
                    }

                    Text("\(listings.count) matches")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, Theme.Spacing.sm)
                        .padding(.vertical, 5)
                        .background(Color.secondary.opacity(0.08), in: Capsule())
                }
            }

            if displayedListings.isEmpty && !isLoading {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("No current matches")
                        .font(.subheadline)
                        .adaptiveFontWeight(.medium)
                    Text("This filter is active, but nothing currently qualifies.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
            } else {
                VStack(spacing: Theme.Spacing.xs) {
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
                                .padding(.leading, 44)
                        }
                    }
                }
            }

            if listings.count > displayedListings.count {
                Button {
                    onShowAll?()
                } label: {
                    Label("Show all \(listings.count)", systemImage: "arrow.right")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentColor)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .dashboardPanelStyle(tint: accentColor)
    }
}

// MARK: - Empty State

private struct ForYouEmptyState: View {
    var onSetUpFilters: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label("No Active Filters", systemImage: "line.3.horizontal.decrease.circle")
        } description: {
            Text("Create active filters to turn this dashboard into a real investor command center.")
        } actions: {
            if let onSetUpFilters {
                Button("Set Up Filters") {
                    onSetUpFilters()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .dashboardPanelStyle(tint: .purple)
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
    .frame(width: 860)
}
