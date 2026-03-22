import os
import SwiftUI

/// Detail view for a single listing, shown in the inspector pane.
struct ListingDetailView: View {
    let listing: Listing
    var onExpandMap: (() -> Void)?
    @Environment(AppState.self) private var appState
    @State private var explanation: ScoreExplanation?
    @State private var priceVersions: [PriceVersion] = []
    @State private var cluster: ListingCluster?
    @State private var isSaved: Bool = false
    @State private var isSaving: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                ListingHeaderSection(
                    listing: listing,
                    isSaved: isSaved,
                    onToggleSave: { Task { await toggleSave() } }
                )

                if let cluster {
                    CrossSourceBadge(cluster: cluster, currentListingId: listing.id)
                }

                FeedbackSection(listingId: listing.id)

                Divider()
                ListingScoreSection(listing: listing, explanation: explanation)

                if let cluster, cluster.members.count >= 2 {
                    Divider()
                    CrossSourceComparisonView(cluster: cluster)
                }

                Divider()
                ListingDetailsSection(listing: listing)
                Divider()
                ListingLocationSection(listing: listing)
                Divider()
                PriceHistoryView(versions: priceVersions)
                Divider()
                ListingMapView(listing: listing, onExpandToFullMap: onExpandMap)
                Divider()
                ListingActionsSection(canonicalUrl: listing.canonicalUrl)
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: listing.id) {
            async let v: Void = loadVersions()
            async let e: Void = loadExplanation()
            async let c: Void = loadCluster()
            async let s: Void = checkIfSaved()
            _ = await (v, e, c, s)
        }
    }

    private func loadExplanation() async {
        do {
            explanation = try await appState.apiClient.fetchScoreExplanation(listingId: listing.id)
        } catch {
            explanation = nil
        }
    }

    private func loadVersions() async {
        do {
            let versions = try await appState.apiClient.fetchListingVersions(id: listing.id)
            priceVersions = versions.compactMap { v -> PriceVersion? in
                guard let priceEurCents = v.listPriceEurCents else { return nil }
                return PriceVersion(
                    date: v.observedAt,
                    priceEur: priceEurCents / 100,
                    reason: v.versionReason
                )
            }
        } catch {
            priceVersions = [
                PriceVersion(
                    date: listing.firstSeenAt,
                    priceEur: listing.listPriceEur,
                    reason: "Current price"
                )
            ]
        }
    }

    private func loadCluster() async {
        do {
            cluster = try await appState.apiClient.fetchListingCluster(listingId: listing.id)
        } catch {
            cluster = nil // 404 = no cluster, expected for single-source listings
        }
    }

    private func checkIfSaved() async {
        do {
            let savedIds = try await appState.apiClient.checkSavedListings(ids: [listing.id])
            isSaved = savedIds.contains(listing.id)
        } catch {
            isSaved = false
        }
    }

    private func toggleSave() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }

        let wasSaved = isSaved
        isSaved.toggle() // Optimistic update

        do {
            if wasSaved {
                try await appState.apiClient.unsaveListing(listingId: listing.id)
            } else {
                try await appState.apiClient.saveListing(listingId: listing.id)
            }
        } catch {
            isSaved = wasSaved // Revert on failure
            Log.ui.error("Save/unsave failed: \(error, privacy: .public)")
        }
    }
}

#Preview {
    ListingDetailView(listing: Listing.samples[0])
        .frame(width: 380, height: 900)
}
