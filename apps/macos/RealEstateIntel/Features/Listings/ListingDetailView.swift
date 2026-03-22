import SwiftUI

/// Detail view for a single listing, shown in the inspector pane.
struct ListingDetailView: View {
    let listing: Listing
    var onExpandMap: (() -> Void)?
    @Environment(AppState.self) private var appState
    @State private var explanation: ScoreExplanation?
    @State private var priceVersions: [PriceVersion] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                ListingHeaderSection(listing: listing)
                Divider()
                ListingScoreSection(listing: listing, explanation: explanation)
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
            await loadVersions()
            await loadExplanation()
        }
    }

    private func loadExplanation() async {
        do {
            explanation = try await appState.apiClient.fetchScoreExplanation(listingId: listing.id)
        } catch {
            explanation = nil
            NSLog("[ListingDetail] Score explanation unavailable: %@", String(describing: error))
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
            // Fallback: show current price as only version
            priceVersions = [
                PriceVersion(
                    date: listing.firstSeenAt,
                    priceEur: listing.listPriceEur,
                    reason: "Current price"
                )
            ]
        }
    }
}

#Preview {
    ListingDetailView(listing: Listing.samples[0])
        .frame(width: 380, height: 900)
}
