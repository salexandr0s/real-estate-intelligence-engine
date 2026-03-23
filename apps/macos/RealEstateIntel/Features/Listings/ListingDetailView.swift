import os
import SwiftUI

/// Detail view for a single listing, shown in the inspector pane.
/// Uses grouped sections with subtle card backgrounds for a native macOS inspector feel.
struct ListingDetailView: View {
    let listing: Listing
    var onExpandMap: (() -> Void)?
    @Environment(AppState.self) private var appState
    @State private var explanation: ScoreExplanation?
    @State private var priceVersions: [PriceVersion] = []
    @State private var cluster: ListingCluster?
    @State private var analysis: ListingAnalysis?
    @State private var isLoadingAnalysis: Bool = false
    @State private var listingDocuments: [ListingDocument] = []
    @State private var isLoadingDocuments: Bool = false
    @State private var isSaved: Bool = false
    @State private var isSaving: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                // Header: status, title, price, score, metrics
                ListingHeaderSection(
                    listing: listing,
                    isSaved: isSaved,
                    cluster: cluster,
                    onToggleSave: { Task { await toggleSave() } }
                )

                FeedbackSection(listingId: listing.id)

                // Score breakdown (collapsible)
                ListingScoreSection(listing: listing, explanation: explanation)

                // Investor analysis (market rent, metrics, building, legal-rent, flags)
                AnalysisSection(analysis: analysis, isLoading: isLoadingAnalysis)

                // Documents (collapsible)
                DocumentsSection(
                    documents: listingDocuments,
                    isLoading: isLoadingDocuments,
                    onLoadFacts: loadDocumentFacts
                )

                if let cluster, cluster.members.count >= 2 {
                    CrossSourceComparisonView(cluster: cluster)
                }

                Divider()

                // Property details + location in 2-column grid
                ListingDetailsSection(listing: listing)

                // Nearby POIs
                ListingLocationSection(listing: listing)

                Divider()

                // Price history
                PriceHistoryView(versions: priceVersions)

                Divider()

                // Map
                ListingMapView(listing: listing, onExpandToFullMap: onExpandMap)

                // Actions
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
            async let a: Void = loadAnalysis()
            async let d: Void = loadDocuments()
            _ = await (v, e, c, s, a, d)
        }
    }

    private func loadExplanation() async {
        do {
            explanation = try await appState.apiClient.fetchScoreExplanation(listingId: listing.id)
        } catch {
            explanation = nil
            Log.ui.error("Failed to load score explanation for listing \(self.listing.id): \(error, privacy: .public)")
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
            Log.ui.error("Failed to load price versions for listing \(self.listing.id): \(error, privacy: .public)")
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
            cluster = nil
            Log.ui.error("Failed to load cluster for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    private func loadAnalysis() async {
        isLoadingAnalysis = true
        do {
            analysis = try await appState.apiClient.fetchAnalysis(listingId: listing.id)
        } catch {
            analysis = nil
            Log.ui.error("Failed to load analysis for listing \(self.listing.id): \(error, privacy: .public)")
        }
        isLoadingAnalysis = false
    }

    private func loadDocuments() async {
        isLoadingDocuments = true
        do {
            listingDocuments = try await appState.apiClient.fetchDocuments(listingId: listing.id)
        } catch {
            listingDocuments = []
            Log.ui.error("Failed to load documents for listing \(self.listing.id): \(error, privacy: .public)")
        }
        isLoadingDocuments = false
    }

    private func loadDocumentFacts(documentId: Int) async -> [DocumentFact] {
        do {
            return try await appState.apiClient.fetchDocumentFacts(documentId: documentId)
        } catch {
            Log.ui.error("Failed to load document facts for document \(documentId): \(error, privacy: .public)")
            return []
        }
    }

    private func checkIfSaved() async {
        do {
            let savedIds = try await appState.apiClient.checkSavedListings(ids: [listing.id])
            isSaved = savedIds.contains(listing.id)
        } catch {
            isSaved = false
            Log.ui.error("Failed to check saved status for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    private func toggleSave() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }

        let wasSaved = isSaved
        isSaved.toggle()

        do {
            if wasSaved {
                try await appState.apiClient.unsaveListing(listingId: listing.id)
            } else {
                try await appState.apiClient.saveListing(listingId: listing.id)
            }
        } catch {
            isSaved = wasSaved
            Log.ui.error("Save/unsave failed: \(error, privacy: .public)")
        }
    }
}

#Preview {
    ListingDetailView(listing: Listing.samples[0])
        .frame(width: 380, height: 900)
}
