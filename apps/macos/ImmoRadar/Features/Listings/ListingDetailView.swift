import os
import SwiftUI

/// Detail view for a single listing, shown in the inspector pane.
/// Uses grouped sections with subtle card backgrounds for a native macOS inspector feel.
struct ListingDetailView: View {
    let listing: Listing
    var onExpandMap: (() -> Void)?
    @Environment(AppState.self) private var appState
    @State private var detailListing: Listing?
    @State private var explanation: ScoreExplanation?
    @State private var priceVersions: [PriceVersion] = []
    @State private var cluster: ListingCluster?
    @State private var analysis: ListingAnalysis?
    @State private var isLoadingAnalysis: Bool = false
    @State private var listingDocuments: [ListingDocument] = []
    @State private var isLoadingDocuments: Bool = false
    @State private var outreachThread: OutreachThread?
    @State private var isLoadingOutreach: Bool = false
    @State private var outreachErrorMessage: String?
    @State private var isSaved: Bool = false
    @State private var isSaving: Bool = false
    @State private var actionErrorMessage: String?

    private var displayedListing: Listing {
        detailListing ?? listing
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                // Header: status, title, price, score, metrics
                ListingHeaderSection(
                    listing: displayedListing,
                    cluster: cluster
                )

                ListingExternalActionsBar(listing: displayedListing)

                ListingPrimaryActionsBar(
                    isSaved: isSaved,
                    isSaving: isSaving,
                    canContact: canContact,
                    isLoadingOutreach: isLoadingOutreach,
                    contactButtonTitle: contactButtonTitle,
                    contactButtonSystemImage: contactButtonSystemImage,
                    contactButtonHelpText: contactButtonHelpText,
                    onToggleSave: { Task { await toggleSave() } },
                    onContact: { Task { await handleContactAction() } }
                )

                if let actionErrorMessage, !actionErrorMessage.isEmpty {
                    Text(actionErrorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                // Key investor metrics ribbon
                KeyMetricsRibbon(analysis: analysis, explanation: explanation)

                ListingAnalysisSection(
                    analysis: analysis,
                    isLoadingAnalysis: isLoadingAnalysis
                )

                // Price history
                PriceHistoryView(versions: priceVersions)

                // Cross-source comparison
                if let cluster, cluster.deduplicatedMembers.count >= 2 {
                    CrossSourceComparisonView(cluster: cluster)
                }

                Divider()

                // Score breakdown
                if let explanation {
                    Text("Score Breakdown")
                        .font(.headline)
                    ScoreBreakdownView(explanation: explanation)
                }

                // Confidence
                if let analysis {
                    AnalysisConfidenceBadge(confidence: analysis.confidence)
                }

                Divider()

                // Property details grid
                ListingDetailsSection(listing: displayedListing)

                OutreachDetailSection(
                    listing: displayedListing,
                    thread: outreachThread,
                    isLoading: isLoadingOutreach,
                    errorMessage: outreachErrorMessage,
                    onStart: { Task { await startOutreach() } },
                    onReload: { Task { await loadOutreachThread() } },
                    onAction: { action in Task { await applyOutreachAction(action) } },
                    onSendFollowup: { Task { await sendFollowup() } }
                )

                // Building context
                if let building = analysis?.buildingContext {
                    AnalysisBuildingContextCard(building: building)
                }

                // Nearby POIs
                ListingLocationSection(listing: displayedListing)

                Divider()

                // Documents
                DocumentsSection(
                    documents: listingDocuments,
                    isLoading: isLoadingDocuments,
                    onLoadFacts: loadDocumentFacts
                )

                Divider()

                // Map
                ListingMapView(listing: displayedListing, onExpandToFullMap: onExpandMap)
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: listing.id) {
            actionErrorMessage = nil

            await loadListingDetail()

            async let v: Void = loadVersions()
            async let e: Void = loadExplanation()
            async let c: Void = loadCluster()
            async let s: Void = checkIfSaved()
            async let a: Void = loadAnalysis()
            async let d: Void = loadDocuments()
            _ = await (v, e, c, s, a, d)

            await loadOutreachThread()
        }
    }

    private func loadListingDetail() async {
        do {
            detailListing = try await appState.apiClient.fetchListing(id: listing.id)
        } catch {
            detailListing = nil
            Log.ui.error("Failed to load listing detail for listing \(self.listing.id): \(error, privacy: .public)")
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
                guard let priceEurCents = v.listPriceEurCents, let observedAt = v.observedAt else { return nil }
                return PriceVersion(
                    date: observedAt,
                    priceEur: priceEurCents / 100,
                    reason: v.versionReason
                )
            }
        } catch {
            Log.ui.error("Failed to load price versions for listing \(self.listing.id): \(error, privacy: .public)")
            if let listPriceEur = listing.listPriceEur, let firstSeenAt = listing.firstSeenAt {
                priceVersions = [
                    PriceVersion(
                        date: firstSeenAt,
                        priceEur: listPriceEur,
                        reason: "Current price"
                    )
                ]
            } else {
                priceVersions = []
            }
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
        actionErrorMessage = nil

        do {
            if wasSaved {
                try await appState.apiClient.unsaveListing(listingId: listing.id)
            } else {
                try await appState.apiClient.saveListing(listingId: listing.id)
            }
        } catch {
            isSaved = wasSaved
            actionErrorMessage = wasSaved
                ? "Could not remove the listing from the watchlist."
                : "Could not save the listing to the watchlist."
            Log.ui.error("Save/unsave failed: \(error, privacy: .public)")
        }
    }

    private var hasOutreachThread: Bool {
        outreachThread != nil || displayedListing.outreachSummary != nil
    }

    private var canContact: Bool {
        hasOutreachThread || displayedListing.contactEmail != nil
    }

    private var contactButtonTitle: String {
        if isLoadingOutreach {
            return "Contacting…"
        }
        return hasOutreachThread ? "Open Outreach" : "Contact"
    }

    private var contactButtonSystemImage: String {
        hasOutreachThread ? "paperplane.circle.fill" : "paperplane"
    }

    private var contactButtonHelpText: String {
        if hasOutreachThread {
            return "Open the outreach workflow"
        }
        if displayedListing.contactEmail != nil {
            return "Start outreach for this listing"
        }
        return "No contact email is available for this listing"
    }

    private func loadOutreachThread() async {
        isLoadingOutreach = true
        defer { isLoadingOutreach = false }

        guard let summary = displayedListing.outreachSummary else {
            outreachThread = nil
            outreachErrorMessage = nil
            return
        }

        do {
            outreachThread = try await appState.apiClient.fetchOutreachThread(id: summary.threadId)
            outreachErrorMessage = nil
        } catch {
            outreachThread = nil
            outreachErrorMessage = error.localizedDescription
            actionErrorMessage = "Could not load the outreach thread."
            Log.ui.error("Failed to load outreach thread for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    private func handleContactAction() async {
        actionErrorMessage = nil

        if let threadID = outreachThread?.id ?? displayedListing.outreachSummary?.threadId {
            appState.openOutreachThread(threadID)
            return
        }

        guard displayedListing.contactEmail != nil else {
            actionErrorMessage = "No contact email is available for this listing."
            return
        }

        await startOutreach()
    }

    private func startOutreach() async {
        guard let contactEmail = displayedListing.contactEmail else { return }

        isLoadingOutreach = true
        defer { isLoadingOutreach = false }
        actionErrorMessage = nil

        do {
            let threadId = try await appState.apiClient.startOutreach(
                listingId: listing.id,
                input: OutreachStartInput(
                    subject: "Anfrage: \(displayedListing.title)",
                    bodyText: "Guten Tag, ich interessiere mich für das Objekt \"\(displayedListing.title)\" und würde mich über weitere Informationen freuen.",
                    contactEmail: contactEmail,
                    contactName: displayedListing.contactName,
                    contactCompany: displayedListing.contactCompany,
                    contactPhone: displayedListing.contactPhone
                )
            )
            detailListing = try await appState.apiClient.fetchListing(id: listing.id)
            outreachThread = try await appState.apiClient.fetchOutreachThread(id: threadId)
            outreachErrorMessage = nil
            appState.openOutreachThread(threadId)
        } catch {
            outreachErrorMessage = error.localizedDescription
            actionErrorMessage = "Could not start outreach for this listing."
            Log.ui.error("Failed to start outreach for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    private func applyOutreachAction(_ action: OutreachAction) async {
        guard let thread = outreachThread else { return }
        do {
            try await appState.apiClient.updateOutreachThread(id: thread.id, action: action)
            detailListing = try await appState.apiClient.fetchListing(id: listing.id)
            await loadOutreachThread()
        } catch {
            outreachErrorMessage = error.localizedDescription
            Log.ui.error("Failed outreach action for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    private func sendFollowup() async {
        guard let thread = outreachThread else { return }
        do {
            try await appState.apiClient.sendOutreachFollowup(id: thread.id)
            detailListing = try await appState.apiClient.fetchListing(id: listing.id)
            await loadOutreachThread()
        } catch {
            outreachErrorMessage = error.localizedDescription
            Log.ui.error("Failed outreach follow-up for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

}

private struct OutreachDetailSection: View {
    let listing: Listing
    let thread: OutreachThread?
    let isLoading: Bool
    let errorMessage: String?
    let onStart: () -> Void
    let onReload: () -> Void
    let onAction: (OutreachAction) -> Void
    let onSendFollowup: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("Outreach")
                    .font(.headline)
                Spacer()
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            if let thread {
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    OutreachWorkflowBadge(state: thread.workflowState)
                    if let lastOutboundAt = thread.lastOutboundAt {
                        Text("Last outbound: \(PriceFormatter.formatDateTime(lastOutboundAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let lastInboundAt = thread.lastInboundAt {
                        Text("Last reply: \(PriceFormatter.formatDateTime(lastInboundAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if thread.unreadInboundCount > 0 {
                        Text("Unread replies: \(thread.unreadInboundCount)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    HStack {
                        Button("Reload", action: onReload)
                        Button("Pause") { onAction(.pause) }
                            .disabled(thread.workflowState == "paused" || thread.workflowState == "closed")
                        Button("Resume") { onAction(.resume) }
                            .disabled(thread.workflowState != "paused")
                        Button("Close") { onAction(.close) }
                            .disabled(thread.workflowState == "closed")
                        Button("Follow-up", action: onSendFollowup)
                            .disabled(thread.lastInboundAt != nil || thread.workflowState == "closed")
                    }

                    if !thread.messages.isEmpty {
                        Divider()
                        ForEach(thread.messages.prefix(3)) { message in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(message.direction.capitalized)
                                        .font(.caption.weight(.semibold))
                                    Spacer()
                                    Text(PriceFormatter.formatDateTime(message.occurredAt))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text(message.subject)
                                    .font(.subheadline.weight(.semibold))
                                if let body = message.bodyText, !body.isEmpty {
                                    Text(body)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(4)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            } else if let contactEmail = listing.contactEmail {
                Text(contactEmail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Start outreach", action: onStart)
            } else {
                Text("No contact email available for this listing.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if let errorMessage, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ListingExternalActionsBar: View {
    let listing: Listing

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Button {
                if let url = URL(string: listing.canonicalUrl) {
                    NSWorkspace.shared.open(url)
                }
            } label: {
                Label("Open in Browser", systemImage: "safari")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.regular)
            .buttonStyle(.borderedProminent)

            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(listing.canonicalUrl, forType: .string)
            } label: {
                Label("Copy URL", systemImage: "doc.on.doc")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.regular)
            .buttonStyle(.bordered)

            if let shareURL = URL(string: listing.canonicalUrl) {
                ShareLink(item: shareURL) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.regular)
                .buttonStyle(.bordered)
            }
        }
    }
}

private struct ListingPrimaryActionsBar: View {
    let isSaved: Bool
    let isSaving: Bool
    let canContact: Bool
    let isLoadingOutreach: Bool
    let contactButtonTitle: String
    let contactButtonSystemImage: String
    let contactButtonHelpText: String
    let onToggleSave: () -> Void
    let onContact: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Button(action: onToggleSave) {
                Label(
                    isSaved ? "Saved to Watchlist" : "Save to Watchlist",
                    systemImage: isSaved ? "bookmark.fill" : "bookmark"
                )
                .frame(maxWidth: .infinity)
            }
            .controlSize(.regular)
            .buttonStyle(.bordered)
            .tint(isSaved ? .orange : .accentColor)
            .disabled(isSaving)
            .help(isSaved ? "Remove from watchlist" : "Save this listing to the watchlist")

            Button(action: onContact) {
                Label(contactButtonTitle, systemImage: contactButtonSystemImage)
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.regular)
            .buttonStyle(.borderedProminent)
            .disabled(!canContact || isLoadingOutreach)
            .help(contactButtonHelpText)
        }
    }
}

private struct ListingAnalysisSection: View {
    let analysis: ListingAnalysis?
    let isLoadingAnalysis: Bool

    var body: some View {
        if isLoadingAnalysis && analysis == nil {
            ProgressView("Loading analysis…")
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, Theme.Spacing.md)
        } else if let analysis {
            if let rent = analysis.marketRentContext {
                AnalysisMarketRentCard(rent: rent)
            }

            if let metrics = analysis.investorMetrics {
                AnalysisInvestorMetricsCard(metrics: metrics)
            }

            if let sale = analysis.marketSaleContext {
                AnalysisSaleContextCard(sale: sale)
            }

            if let legal = analysis.legalRentSummary {
                AnalysisLegalRentCard(legal: legal)
            }

            if !analysis.riskFlags.isEmpty && !analysis.upsideFlags.isEmpty {
                HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                    AnalysisFlagsList(title: "Risk Flags", flags: analysis.riskFlags, color: .red)
                        .frame(maxWidth: .infinity)
                    AnalysisFlagsList(title: "Upside Flags", flags: analysis.upsideFlags, color: .green)
                        .frame(maxWidth: .infinity)
                }
            } else {
                if !analysis.riskFlags.isEmpty {
                    AnalysisFlagsList(title: "Risk Flags", flags: analysis.riskFlags, color: .red)
                }
                if !analysis.upsideFlags.isEmpty {
                    AnalysisFlagsList(title: "Upside Flags", flags: analysis.upsideFlags, color: .green)
                }
            }

            if !analysis.missingData.isEmpty {
                AnalysisMissingDataList(items: analysis.missingData)
            }

            if !analysis.assumptions.isEmpty {
                AnalysisAssumptionsList(items: analysis.assumptions)
            }
        }
    }
}

#Preview {
    ListingDetailView(listing: Listing.samples[0])
        .frame(width: 380, height: 900)
}
