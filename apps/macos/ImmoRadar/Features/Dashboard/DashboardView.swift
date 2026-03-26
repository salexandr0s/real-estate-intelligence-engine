import SwiftUI

/// Dashboard — summary metrics + focused investor brief + filter-matched listings.
struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = DashboardViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                if let error = viewModel.errorMessage {
                    DashboardErrorBanner(message: error) {
                        Task { await viewModel.refresh(using: appState.apiClient) }
                    }
                }

                if let priorityListing = viewModel.priorityListing {
                    PriorityBriefingCard(
                        listing: priorityListing,
                        matchedFilterCount: viewModel.matchedFilterCount,
                        onOpenListing: {
                            appState.deepLinkListingId = priorityListing.id
                            appState.selectedNavItem = .listings
                        },
                        onOpenFilters: {
                            appState.navigateTo(.filters)
                        }
                    )
                }

                SummaryStripView(
                    cards: viewModel.summaryCards(
                        unreadAlertCount: appState.unreadAlertCount
                    ),
                    onCardNavigate: { cardId in
                        switch cardId {
                        case "active-listings", "new-this-week", "high-score":
                            appState.navigateTo(.listings)
                        case "active-filters":
                            appState.navigateTo(.filters)
                        case "unread-alerts":
                            appState.navigateTo(.alerts)
                        default:
                            break
                        }
                    }
                )

                ForYouSection(
                    activeFilters: viewModel.activeFilters,
                    filterListings: viewModel.filterListings,
                    filterLoadingStates: viewModel.filterLoadingStates,
                    isLoading: viewModel.isLoading,
                    onListingTap: { id in
                        appState.deepLinkListingId = id
                        appState.selectedNavItem = .listings
                    },
                    onNavigateToFilters: {
                        appState.navigateTo(.filters)
                    },
                    onNavigateToListings: {
                        appState.navigateTo(.listings)
                    }
                )
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .navigationTitle("Dashboard")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .toolbar(id: "dashboard") {
            ToolbarItem(id: "refresh", placement: .automatic) {
                Button {
                    Task { await viewModel.refresh(using: appState.apiClient) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(viewModel.isLoading)
                .help("Refresh dashboard")
            }
        }
        .task {
            await viewModel.refresh(using: appState.apiClient)
        }
    }
}

private struct PriorityBriefingCard: View {
    let listing: Listing
    let matchedFilterCount: Int
    let onOpenListing: () -> Void
    let onOpenFilters: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.xl) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Text("Today’s edge")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(listing.title)
                    .font(.title3)
                    .adaptiveFontWeight(.semibold)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Highest-priority match across your active filters, surfaced first so your morning scan starts with a concrete opportunity.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: Theme.Spacing.md) {
                    Label(PriceFormatter.format(eur: listing.listPriceEur), systemImage: "eurosign.circle")
                    if let district = listing.districtName {
                        Label(district, systemImage: "mappin")
                    }
                    if let area = listing.livingAreaSqm {
                        Label(PriceFormatter.formatArea(area), systemImage: "ruler")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                HStack(spacing: Theme.Spacing.sm) {
                    Button("Open Listing", action: onOpenListing)
                        .buttonStyle(.borderedProminent)
                    Button("Review Filters", action: onOpenFilters)
                        .buttonStyle(.bordered)
                }
            }

            Spacer(minLength: 0)

            VStack(alignment: .trailing, spacing: Theme.Spacing.sm) {
                if let score = listing.currentScore {
                    ScoreIndicator(score: score, size: .large)
                }
                Text("\(matchedFilterCount) filters currently returning matches")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
            }
        }
        .cardStyle()
    }
}

#Preview {
    DashboardView()
        .environment(AppState())
        .frame(width: 900, height: 600)
}
