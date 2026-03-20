import SwiftUI

/// Detail view for a single listing, shown in the inspector pane.
struct ListingDetailView: View {
    let listing: Listing
    @State private var explanation: ScoreExplanation? = Listing.sampleExplanation

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
                priceHistoryPlaceholder
                Divider()
                mapPlaceholder
                Divider()
                actionsSection
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    // MARK: - Placeholders

    private var priceHistoryPlaceholder: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Price History")
                .font(.headline)

            ContentUnavailableView {
                Label("No price history", systemImage: "chart.line.uptrend.xyaxis")
            } description: {
                Text("Price history chart will appear here when the backend provides historical data.")
            }
        }
    }

    private var mapPlaceholder: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("Map")
                .font(.headline)

            ContentUnavailableView {
                Label("No location data", systemImage: "map")
            } description: {
                Text("Map view will appear here when geolocation data is available.")
            }
        }
    }

    // MARK: - Actions

    private var actionsSection: some View {
        VStack(spacing: Theme.Spacing.sm) {
            Button {
                if let url = URL(string: listing.canonicalUrl) {
                    NSWorkspace.shared.open(url)
                }
            } label: {
                Label("Open in Browser", systemImage: "safari")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)

            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(listing.canonicalUrl, forType: .string)
            } label: {
                Label("Copy URL", systemImage: "doc.on.doc")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.bordered)
        }
    }
}

#Preview {
    ListingDetailView(listing: Listing.samples[0])
        .frame(width: 380, height: 900)
}
