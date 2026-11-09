import SwiftUI

@MainActor @Observable
final class ListingDetailViewModel {
    private(set) var listing: Listing
    var detailListing: Listing?
    var explanation: ScoreExplanation?
    /// True when the score breakdown couldn't load. A listing that has no score yet isn't a failure.
    var explanationLoadFailed = false
    var isLoadingExplanation = false
    var priceVersions: [PriceVersion] = []
    var cluster: ListingCluster?
    var analysis: ListingAnalysis?
    var isLoadingAnalysis = false
    var listingDocuments: [ListingDocument] = []
    var isLoadingDocuments = false
    var outreachThread: OutreachThread?
    var isLoadingOutreach = false
    /// The outreach thread didn't load. The view hides it while the app shows its connection warning.
    var outreachErrorMessage: String?
    /// The last start, thread action or follow-up the user sent failed.
    var outreachFailure: OutreachRequestFailure?
    /// The thread action or follow-up being sent. One goes out at a time.
    var outreachRequestInFlight: OutreachThreadRequest?
    /// Whether the listing is on the watchlist, or nil until the server says. Save stays off
    /// while it's nil, because the button can't tell whether to save or remove.
    var isSaved: Bool?
    var isSaving = false
    var actionErrorMessage: String?

    /// The listing a load belongs to, and which load of it.
    private struct LoadToken: Equatable {
        let listingID: Int
        let generation: Int
    }

    /// Goes up with every `load`. A response to an earlier load, of this listing or of the one shown
    /// before it, is dropped instead of filling in the listing shown now.
    @ObservationIgnored private var loadGeneration = 0

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

    /// Loads everything the inspector shows for `listing`. The view runs this in `.task(id:)`, so
    /// selecting another listing cancels it, and anything it still receives afterwards is dropped.
    func load(using apiClient: APIClient, listing: Listing) async {
        prepare(for: listing)
        actionErrorMessage = nil
        let token = currentToken

        await loadListingDetail(using: apiClient, token: token)
        guard isCurrent(token) else { return }

        async let versions: Void = loadVersions(using: apiClient, token: token)
        async let explanation: Void = loadExplanation(using: apiClient, token: token)
        async let cluster: Void = loadCluster(using: apiClient, token: token)
        async let savedStatus: Void = checkIfSaved(using: apiClient, token: token)
        async let analysis: Void = loadAnalysis(using: apiClient, token: token)
        async let documents: Void = loadDocuments(using: apiClient, token: token)
        _ = await (versions, explanation, cluster, savedStatus, analysis, documents)

        guard isCurrent(token) else { return }
        await loadOutreachThread(using: apiClient)
    }

    /// Asks for the score breakdown again after it failed to load.
    func retryExplanation(using apiClient: APIClient) async {
        await loadExplanation(using: apiClient, token: currentToken)
    }

    func toggleSave(using apiClient: APIClient) async {
        guard !isSaving, let wasSaved = isSaved else { return }

        let listingID = listing.id
        isSaving = true
        isSaved = !wasSaved
        actionErrorMessage = nil

        do {
            if wasSaved {
                try await apiClient.unsaveListing(listingId: listingID)
            } else {
                try await apiClient.saveListing(listingId: listingID)
            }
        } catch {
            Log.ui.error("Save/unsave failed: \(error, privacy: .public)")
            if isShowing(listingID) {
                isSaved = wasSaved
                actionErrorMessage = wasSaved
                    ? "Could not remove the listing from the watchlist."
                    : "Could not save the listing to the watchlist."
            }
        }

        if isShowing(listingID) {
            isSaving = false
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

        let listingID = listing.id
        let input = OutreachStartInput(
            subject: "Anfrage: \(displayedListing.title)",
            bodyText: "Guten Tag, ich interessiere mich für das Objekt \"\(displayedListing.title)\" und würde mich über weitere Informationen freuen.",
            contactEmail: contactEmail,
            contactName: displayedListing.contactName,
            contactCompany: displayedListing.contactCompany,
            contactPhone: displayedListing.contactPhone
        )

        isLoadingOutreach = true
        actionErrorMessage = nil
        outreachFailure = nil
        defer {
            if isShowing(listingID) { isLoadingOutreach = false }
        }

        let threadId: Int
        do {
            threadId = try await apiClient.startOutreach(listingId: listingID, input: input)
        } catch {
            Log.ui.error("Failed to start outreach for listing \(listingID): \(error, privacy: .public)")
            guard isShowing(listingID) else { return nil }
            let failure = OutreachRequestFailure(request: .start, error: error)
            outreachFailure = failure
            actionErrorMessage = "Could not start outreach for this listing."
            // After a 503 the server keeps the new thread as failed, and a 409 means a thread is
            // already open. Load that thread, so the section offers its actions, Retry included.
            if failure.enqueueFailed || failure.isConflict {
                await reloadOutreach(using: apiClient, listingID: listingID)
            }
            return nil
        }

        if isShowing(listingID) {
            await reloadOutreach(using: apiClient, listingID: listingID, threadID: threadId)
        }
        return threadId
    }

    /// Loads the thread with `threadID`, or else the listing's own thread.
    func loadOutreachThread(using apiClient: APIClient, threadID: Int? = nil) async {
        let token = currentToken
        isLoadingOutreach = true
        defer {
            if isCurrent(token) { isLoadingOutreach = false }
        }

        guard let threadID = threadID ?? displayedListing.outreachSummary?.threadId else {
            outreachThread = nil
            outreachErrorMessage = nil
            return
        }

        do {
            let thread = try await apiClient.fetchOutreachThread(id: threadID)
            guard isCurrent(token) else { return }
            outreachThread = thread
            outreachErrorMessage = nil
        } catch {
            guard isCurrent(token) else { return }
            // A failed reload keeps the thread on screen. A thread that never loaded shows the error.
            if outreachThread?.id != threadID {
                outreachThread = nil
            }
            outreachErrorMessage = AppErrorPresentation.message(for: error)
            Log.ui.error("Failed to load outreach thread for listing \(token.listingID): \(error, privacy: .public)")
        }
    }

    func applyOutreachAction(_ action: OutreachAction, using apiClient: APIClient) async {
        await runOutreachRequest(.action(action), using: apiClient) { threadID in
            try await apiClient.updateOutreachThread(id: threadID, action: action)
        }
    }

    func sendFollowup(using apiClient: APIClient) async {
        await runOutreachRequest(.followup, using: apiClient) { threadID in
            try await apiClient.sendOutreachFollowup(id: threadID)
        }
    }

    /// Sends the failed request again after the server couldn't queue its email.
    func tryOutreachRequestAgain(using apiClient: APIClient) async {
        guard let failure = outreachFailure, failure.canTryAgain else { return }
        switch failure.request {
        case .action(let action):
            await applyOutreachAction(action, using: apiClient)
        case .followup:
            await sendFollowup(using: apiClient)
        case .start:
            break
        }
    }

    func dismissOutreachFailure() {
        outreachFailure = nil
    }

    /// Sends one request for the thread on screen. A success or a 409 reloads the listing and the
    /// thread, so the buttons offer what the server accepts now.
    private func runOutreachRequest(
        _ request: OutreachThreadRequest,
        using apiClient: APIClient,
        _ operation: (Int) async throws -> Void
    ) async {
        guard let thread = outreachThread, outreachRequestInFlight == nil else { return }
        let listingID = listing.id
        outreachRequestInFlight = request
        outreachFailure = nil
        defer {
            if isShowing(listingID) { outreachRequestInFlight = nil }
        }

        do {
            try await operation(thread.id)
        } catch {
            Log.ui.error("Outreach request failed for listing \(listingID): \(error, privacy: .public)")
            guard isShowing(listingID) else { return }
            let failure = OutreachRequestFailure(request: request, error: error)
            outreachFailure = failure
            guard failure.isConflict else { return }
        }

        guard isShowing(listingID) else { return }
        await reloadOutreach(using: apiClient, listingID: listingID, threadID: thread.id)
    }

    /// Reloads the listing, whose outreach summary changes with the thread, and then the thread.
    private func reloadOutreach(using apiClient: APIClient, listingID: Int, threadID: Int? = nil) async {
        if let refreshedListing = try? await apiClient.fetchListing(id: listingID), isShowing(listingID) {
            detailListing = refreshedListing
        }
        guard isShowing(listingID) else { return }
        await loadOutreachThread(using: apiClient, threadID: threadID)
    }

    func loadDocumentFacts(documentId: Int, using apiClient: APIClient) async -> [DocumentFact] {
        do {
            return try await apiClient.fetchDocumentFacts(documentId: documentId)
        } catch {
            Log.ui.error("Failed to load document facts for document \(documentId): \(error, privacy: .public)")
            return []
        }
    }

    // MARK: - Load Tokens

    private var currentToken: LoadToken {
        LoadToken(listingID: listing.id, generation: loadGeneration)
    }

    /// Whether a load started with `token` may still change what the inspector shows.
    private func isCurrent(_ token: LoadToken) -> Bool {
        !Task.isCancelled && token == currentToken
    }

    /// Whether the inspector still shows the listing a user action started on.
    private func isShowing(_ listingID: Int) -> Bool {
        listing.id == listingID
    }

    private func prepare(for listing: Listing) {
        loadGeneration += 1
        let didChangeListing = self.listing.id != listing.id
        self.listing = listing

        guard didChangeListing else { return }

        detailListing = nil
        explanation = nil
        explanationLoadFailed = false
        isLoadingExplanation = false
        priceVersions = []
        cluster = nil
        analysis = nil
        isLoadingAnalysis = false
        listingDocuments = []
        isLoadingDocuments = false
        outreachThread = nil
        isLoadingOutreach = false
        outreachErrorMessage = nil
        outreachFailure = nil
        outreachRequestInFlight = nil
        isSaved = nil
        isSaving = false
        actionErrorMessage = nil
    }

    // MARK: - Loads

    private func loadListingDetail(using apiClient: APIClient, token: LoadToken) async {
        do {
            let detail = try await apiClient.fetchListing(id: token.listingID)
            guard isCurrent(token) else { return }
            detailListing = detail
        } catch {
            guard isCurrent(token) else { return }
            detailListing = nil
            Log.ui.error("Failed to load listing detail for listing \(token.listingID): \(error, privacy: .public)")
        }
    }

    private func loadExplanation(using apiClient: APIClient, token: LoadToken) async {
        isLoadingExplanation = true
        defer {
            if isCurrent(token) { isLoadingExplanation = false }
        }

        do {
            let loaded = try await apiClient.fetchScoreExplanation(listingId: token.listingID)
            guard isCurrent(token) else { return }
            explanation = loaded
            explanationLoadFailed = false
        } catch APIError.notFound {
            // The listing has no score yet, so there is no breakdown to show.
            guard isCurrent(token) else { return }
            explanation = nil
            explanationLoadFailed = false
        } catch {
            guard isCurrent(token) else { return }
            // A breakdown loaded earlier for this listing stays on screen.
            explanationLoadFailed = explanation == nil
            Log.ui.error("Failed to load score explanation for listing \(token.listingID): \(error, privacy: .public)")
        }
    }

    private func loadVersions(using apiClient: APIClient, token: LoadToken) async {
        do {
            let versions = try await apiClient.fetchListingVersions(id: token.listingID)
            guard isCurrent(token) else { return }
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
            guard isCurrent(token) else { return }
            Log.ui.error("Failed to load price versions for listing \(token.listingID): \(error, privacy: .public)")
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

    private func loadCluster(using apiClient: APIClient, token: LoadToken) async {
        do {
            let loaded = try await apiClient.fetchListingCluster(listingId: token.listingID)
            guard isCurrent(token) else { return }
            cluster = loaded
        } catch {
            guard isCurrent(token) else { return }
            cluster = nil
            Log.ui.error("Failed to load cluster for listing \(token.listingID): \(error, privacy: .public)")
        }
    }

    private func loadAnalysis(using apiClient: APIClient, token: LoadToken) async {
        isLoadingAnalysis = true
        defer {
            if isCurrent(token) { isLoadingAnalysis = false }
        }

        do {
            let loaded = try await apiClient.fetchAnalysis(listingId: token.listingID)
            guard isCurrent(token) else { return }
            analysis = loaded
        } catch {
            guard isCurrent(token) else { return }
            analysis = nil
            Log.ui.error("Failed to load analysis for listing \(token.listingID): \(error, privacy: .public)")
        }
    }

    private func loadDocuments(using apiClient: APIClient, token: LoadToken) async {
        isLoadingDocuments = true
        defer {
            if isCurrent(token) { isLoadingDocuments = false }
        }

        do {
            let loaded = try await apiClient.fetchDocuments(listingId: token.listingID)
            guard isCurrent(token) else { return }
            listingDocuments = loaded
        } catch {
            guard isCurrent(token) else { return }
            listingDocuments = []
            Log.ui.error("Failed to load documents for listing \(token.listingID): \(error, privacy: .public)")
        }
    }

    private func checkIfSaved(using apiClient: APIClient, token: LoadToken) async {
        do {
            let savedIds = try await apiClient.checkSavedListings(ids: [token.listingID])
            guard isCurrent(token) else { return }
            isSaved = savedIds.contains(token.listingID)
        } catch {
            // The status stays unknown, so Save stays off.
            Log.ui.error("Failed to check saved status for listing \(token.listingID): \(error, privacy: .public)")
        }
    }
}
