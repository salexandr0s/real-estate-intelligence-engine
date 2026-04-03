import SwiftUI

@MainActor @Observable
final class ListingDetailViewModel {
    private(set) var listing: Listing
    var detailListing: Listing?
    var explanation: ScoreExplanation?
    var priceVersions: [PriceVersion] = []
    var cluster: ListingCluster?
    var analysis: ListingAnalysis?
    var isLoadingAnalysis = false
    var listingDocuments: [ListingDocument] = []
    var isLoadingDocuments = false
    var outreachThread: OutreachThread?
    var isLoadingOutreach = false
    var outreachErrorMessage: String?
    var isSaved = false
    var isSaving = false
    var actionErrorMessage: String?

    init(listing: Listing) {
        self.listing = listing
    }

    var displayedListing: Listing {
        detailListing ?? listing
    }

    var hasOutreachThread: Bool {
        outreachThread != nil || displayedListing.outreachSummary != nil
    }

    var canContact: Bool {
        hasOutreachThread || displayedListing.contactEmail != nil
    }

    var contactButtonTitle: String {
        if isLoadingOutreach {
            return "Contacting…"
        }

        return hasOutreachThread ? "Open Outreach" : "Contact"
    }

    var contactButtonSystemImage: String {
        hasOutreachThread ? "paperplane.circle.fill" : "paperplane"
    }

    var contactButtonHelpText: String {
        if hasOutreachThread {
            return "Open the outreach workflow"
        }

        if displayedListing.contactEmail != nil {
            return "Start outreach for this listing"
        }

        return "No contact email is available for this listing"
    }

    func load(using apiClient: APIClient, listing: Listing) async {
        prepare(for: listing)
        actionErrorMessage = nil

        await loadListingDetail(using: apiClient)

        async let versions: Void = loadVersions(using: apiClient)
        async let explanation: Void = loadExplanation(using: apiClient)
        async let cluster: Void = loadCluster(using: apiClient)
        async let savedStatus: Void = checkIfSaved(using: apiClient)
        async let analysis: Void = loadAnalysis(using: apiClient)
        async let documents: Void = loadDocuments(using: apiClient)
        _ = await (versions, explanation, cluster, savedStatus, analysis, documents)

        await loadOutreachThread(using: apiClient)
    }

    func toggleSave(using apiClient: APIClient) async {
        guard !isSaving else { return }

        isSaving = true
        defer { isSaving = false }

        let wasSaved = isSaved
        isSaved.toggle()
        actionErrorMessage = nil

        do {
            if wasSaved {
                try await apiClient.unsaveListing(listingId: listing.id)
            } else {
                try await apiClient.saveListing(listingId: listing.id)
            }
        } catch {
            isSaved = wasSaved
            actionErrorMessage = wasSaved
                ? "Could not remove the listing from the watchlist."
                : "Could not save the listing to the watchlist."
            Log.ui.error("Save/unsave failed: \(error, privacy: .public)")
        }
    }

    func handleContactAction(using apiClient: APIClient) async -> Int? {
        actionErrorMessage = nil

        if let threadID = outreachThread?.id ?? displayedListing.outreachSummary?.threadId {
            return threadID
        }

        guard displayedListing.contactEmail != nil else {
            actionErrorMessage = "No contact email is available for this listing."
            return nil
        }

        return await startOutreach(using: apiClient)
    }

    func startOutreach(using apiClient: APIClient) async -> Int? {
        guard let contactEmail = displayedListing.contactEmail else { return nil }

        isLoadingOutreach = true
        defer { isLoadingOutreach = false }

        actionErrorMessage = nil

        do {
            let threadId = try await apiClient.startOutreach(
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
            detailListing = try await apiClient.fetchListing(id: listing.id)
            outreachThread = try await apiClient.fetchOutreachThread(id: threadId)
            outreachErrorMessage = nil
            return threadId
        } catch {
            outreachErrorMessage = error.localizedDescription
            actionErrorMessage = "Could not start outreach for this listing."
            Log.ui.error("Failed to start outreach for listing \(self.listing.id): \(error, privacy: .public)")
            return nil
        }
    }

    func loadOutreachThread(using apiClient: APIClient) async {
        isLoadingOutreach = true
        defer { isLoadingOutreach = false }

        guard let summary = displayedListing.outreachSummary else {
            outreachThread = nil
            outreachErrorMessage = nil
            return
        }

        do {
            outreachThread = try await apiClient.fetchOutreachThread(id: summary.threadId)
            outreachErrorMessage = nil
        } catch {
            outreachThread = nil
            outreachErrorMessage = error.localizedDescription
            actionErrorMessage = "Could not load the outreach thread."
            Log.ui.error("Failed to load outreach thread for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    func applyOutreachAction(_ action: OutreachAction, using apiClient: APIClient) async {
        guard let thread = outreachThread else { return }

        do {
            try await apiClient.updateOutreachThread(id: thread.id, action: action)
            detailListing = try await apiClient.fetchListing(id: listing.id)
            await loadOutreachThread(using: apiClient)
        } catch {
            outreachErrorMessage = error.localizedDescription
            Log.ui.error("Failed outreach action for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    func sendFollowup(using apiClient: APIClient) async {
        guard let thread = outreachThread else { return }

        do {
            try await apiClient.sendOutreachFollowup(id: thread.id)
            detailListing = try await apiClient.fetchListing(id: listing.id)
            await loadOutreachThread(using: apiClient)
        } catch {
            outreachErrorMessage = error.localizedDescription
            Log.ui.error("Failed outreach follow-up for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    func loadDocumentFacts(documentId: Int, using apiClient: APIClient) async -> [DocumentFact] {
        do {
            return try await apiClient.fetchDocumentFacts(documentId: documentId)
        } catch {
            Log.ui.error("Failed to load document facts for document \(documentId): \(error, privacy: .public)")
            return []
        }
    }

    private func prepare(for listing: Listing) {
        let didChangeListing = self.listing.id != listing.id
        self.listing = listing

        guard didChangeListing else { return }

        detailListing = nil
        explanation = nil
        priceVersions = []
        cluster = nil
        analysis = nil
        isLoadingAnalysis = false
        listingDocuments = []
        isLoadingDocuments = false
        outreachThread = nil
        isLoadingOutreach = false
        outreachErrorMessage = nil
        isSaved = false
        isSaving = false
        actionErrorMessage = nil
    }

    private func loadListingDetail(using apiClient: APIClient) async {
        do {
            detailListing = try await apiClient.fetchListing(id: listing.id)
        } catch {
            detailListing = nil
            Log.ui.error("Failed to load listing detail for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    private func loadExplanation(using apiClient: APIClient) async {
        do {
            explanation = try await apiClient.fetchScoreExplanation(listingId: listing.id)
        } catch {
            explanation = nil
            Log.ui.error("Failed to load score explanation for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    private func loadVersions(using apiClient: APIClient) async {
        do {
            let versions = try await apiClient.fetchListingVersions(id: listing.id)
            priceVersions = versions.compactMap { version -> PriceVersion? in
                guard let priceEurCents = version.listPriceEurCents,
                      let observedAt = version.observedAt else {
                    return nil
                }

                return PriceVersion(
                    date: observedAt,
                    priceEur: priceEurCents / 100,
                    reason: version.versionReason
                )
            }
        } catch {
            Log.ui.error("Failed to load price versions for listing \(self.listing.id): \(error, privacy: .public)")
            if let listPriceEur = listing.listPriceEur,
               let firstSeenAt = listing.firstSeenAt {
                priceVersions = [
                    PriceVersion(
                        date: firstSeenAt,
                        priceEur: listPriceEur,
                        reason: "Current price"
                    ),
                ]
            } else {
                priceVersions = []
            }
        }
    }

    private func loadCluster(using apiClient: APIClient) async {
        do {
            cluster = try await apiClient.fetchListingCluster(listingId: listing.id)
        } catch {
            cluster = nil
            Log.ui.error("Failed to load cluster for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    private func loadAnalysis(using apiClient: APIClient) async {
        isLoadingAnalysis = true
        defer { isLoadingAnalysis = false }

        do {
            analysis = try await apiClient.fetchAnalysis(listingId: listing.id)
        } catch {
            analysis = nil
            Log.ui.error("Failed to load analysis for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    private func loadDocuments(using apiClient: APIClient) async {
        isLoadingDocuments = true
        defer { isLoadingDocuments = false }

        do {
            listingDocuments = try await apiClient.fetchDocuments(listingId: listing.id)
        } catch {
            listingDocuments = []
            Log.ui.error("Failed to load documents for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }

    private func checkIfSaved(using apiClient: APIClient) async {
        do {
            let savedIds = try await apiClient.checkSavedListings(ids: [listing.id])
            isSaved = savedIds.contains(listing.id)
        } catch {
            isSaved = false
            Log.ui.error("Failed to check saved status for listing \(self.listing.id): \(error, privacy: .public)")
        }
    }
}
