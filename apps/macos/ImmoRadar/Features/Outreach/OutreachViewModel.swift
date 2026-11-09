import Foundation

protocol OutreachAPIClient: Actor {
    func fetchMailboxes() async throws -> [MailboxAccount]
    func fetchOutreachThreads(
        scope: OutreachScope,
        cursor: String?,
        limit: Int?
    ) async throws -> (threads: [OutreachThreadSummary], nextCursor: String?)
    func fetchOutreachThread(id: Int) async throws -> OutreachThread
    func fetchListing(id: Int) async throws -> Listing
    func syncMailbox(id: Int) async throws
    func updateOutreachThread(id: Int, action: OutreachAction) async throws
    func sendOutreachFollowup(id: Int, subject: String?, bodyText: String?) async throws
}

extension APIClient: OutreachAPIClient {}

@MainActor @Observable
final class OutreachViewModel {
    var mailboxes: [MailboxAccount] = []
    var threads: [OutreachThreadSummary] = []
    var selectedScope: OutreachScope = .open
    var selectedThreadID: Int?
    var selectedThread: OutreachThread?
    var selectedListing: Listing?
    var isLoadingList = false
    var isLoadingThread = false
    var isSyncingMailbox = false
    /// The pause, resume, close, retry or follow-up being sent. One goes out at a time.
    var actionInFlight: OutreachThreadRequest?
    /// The mailbox or the thread list didn't load.
    var pageErrorMessage: String?
    /// The selected thread didn't load.
    var detailErrorMessage: String?
    /// The mailbox sync the user asked for failed.
    var syncErrorMessage: String?
    /// The last thread request the user sent failed. The next request or another thread clears it.
    var actionFailure: OutreachRequestFailure?
    var hasLoaded = false
    private var nextCursor: String?
    /// Goes up with every thread load, so an earlier, slower load can't replace the thread shown now.
    @ObservationIgnored private var threadLoadID = 0
    /// The thread a load is fetching, so selecting it again doesn't fetch it twice.
    @ObservationIgnored private var threadIDInFlight: Int?

    var selectedMailbox: MailboxAccount? { mailboxes.first }

    func refresh(using client: any OutreachAPIClient) async {
        isLoadingList = true
        pageErrorMessage = nil

        do {
            async let mailboxRows = client.fetchMailboxes()
            async let threadResult = client.fetchOutreachThreads(
                scope: selectedScope,
                cursor: nil,
                limit: 25
            )
            let (loadedMailboxes, loadedThreadsResult) = try await (mailboxRows, threadResult)

            mailboxes = loadedMailboxes
            threads = loadedThreadsResult.threads
            nextCursor = loadedThreadsResult.nextCursor
            hasLoaded = true

            let nextSelection = resolvedSelectionID(from: loadedThreadsResult.threads)
            selectedThreadID = nextSelection

            if let nextSelection {
                await loadThread(id: nextSelection, using: client)
            } else {
                selectedThread = nil
                selectedListing = nil
                detailErrorMessage = nil
            }
        } catch {
            pageErrorMessage = Self.message(
                for: error,
                fallback: "Outreach is currently unavailable. Check mailbox configuration and try again."
            )
            hasLoaded = true
        }

        isLoadingList = false
    }

    func setScope(_ scope: OutreachScope, using client: any OutreachAPIClient) async {
        guard selectedScope != scope else { return }
        selectedScope = scope
        await refresh(using: client)
    }

    /// Loads a thread picked in the list. The list's selection binding has already set
    /// `selectedThreadID`, so this compares against the thread on screen.
    func selectThread(id: Int, using client: any OutreachAPIClient) async {
        guard selectedThread?.id != id, threadIDInFlight != id else { return }
        selectedThreadID = id
        actionFailure = nil
        await loadThread(id: id, using: client)
    }

    func openThread(id: Int, using client: any OutreachAPIClient) async {
        selectedScope = .all
        if selectedThread?.id != id {
            actionFailure = nil
        }

        if mailboxes.isEmpty || !threads.contains(where: { $0.id == id }) {
            isLoadingList = true
            pageErrorMessage = nil

            do {
                async let mailboxRows = client.fetchMailboxes()
                async let threadResult = client.fetchOutreachThreads(
                    scope: .all,
                    cursor: nil,
                    limit: 25
                )
                let (loadedMailboxes, loadedThreadsResult) = try await (mailboxRows, threadResult)

                mailboxes = loadedMailboxes
                threads = loadedThreadsResult.threads
                nextCursor = loadedThreadsResult.nextCursor
                hasLoaded = true
            } catch {
                pageErrorMessage = Self.message(
                    for: error,
                    fallback: "Outreach is currently unavailable. Check mailbox configuration and try again."
                )
            }

            isLoadingList = false
        }

        selectedThreadID = id
        await loadThread(id: id, using: client)
    }

    func syncPrimaryMailbox(using client: any OutreachAPIClient) async {
        guard let mailbox = selectedMailbox else { return }
        isSyncingMailbox = true
        syncErrorMessage = nil

        do {
            try await client.syncMailbox(id: mailbox.id)
            await refresh(using: client)
        } catch {
            syncErrorMessage = Self.message(for: error, fallback: "Mailbox sync failed. Try again in a moment.")
        }

        isSyncingMailbox = false
    }

    func reloadSelectedThread(using client: any OutreachAPIClient) async {
        guard let selectedThreadID else {
            await refresh(using: client)
            return
        }
        await loadThread(id: selectedThreadID, using: client)
    }

    func performThreadAction(_ action: OutreachAction, using client: any OutreachAPIClient) async {
        await runThreadRequest(.action(action), using: client) { threadID in
            try await client.updateOutreachThread(id: threadID, action: action)
        }
    }

    func sendFollowup(using client: any OutreachAPIClient) async {
        await runThreadRequest(.followup, using: client) { threadID in
            try await client.sendOutreachFollowup(id: threadID, subject: nil, bodyText: nil)
        }
    }

    /// Sends the failed request again after the server couldn't queue its email.
    func tryFailedRequestAgain(using client: any OutreachAPIClient) async {
        guard let failure = actionFailure, failure.canTryAgain else { return }
        switch failure.request {
        case .action(let action):
            await performThreadAction(action, using: client)
        case .followup:
            await sendFollowup(using: client)
        case .start:
            break
        }
    }

    func dismissActionFailure() {
        actionFailure = nil
    }

    /// Sends one request for the thread on screen. A success or a 409 reloads the list and the
    /// thread, so the buttons offer what the server accepts now. The failure keeps the server's
    /// message either way.
    private func runThreadRequest(
        _ request: OutreachThreadRequest,
        using client: any OutreachAPIClient,
        _ operation: (Int) async throws -> Void
    ) async {
        guard let thread = selectedThread, actionInFlight == nil else { return }
        actionInFlight = request
        actionFailure = nil

        do {
            try await operation(thread.id)
            await refresh(using: client)
        } catch {
            let failure = OutreachRequestFailure(request: request, error: error)
            actionFailure = failure
            if failure.isConflict {
                await refresh(using: client)
            }
        }

        actionInFlight = nil
    }

    private func loadThread(id: Int, using client: any OutreachAPIClient) async {
        threadLoadID += 1
        let loadID = threadLoadID
        threadIDInFlight = id
        isLoadingThread = true
        detailErrorMessage = nil
        defer {
            if loadID == threadLoadID {
                isLoadingThread = false
                threadIDInFlight = nil
            }
        }

        do {
            let loadedThread = try await client.fetchOutreachThread(id: id)
            guard loadID == threadLoadID else { return }
            if selectedListing?.id != loadedThread.listingId {
                selectedListing = nil
            }
            selectedThread = loadedThread
            // The thread works without its listing, so a failed listing load only hides the
            // linked listing card.
            let listing = try? await client.fetchListing(id: loadedThread.listingId)
            guard loadID == threadLoadID else { return }
            if let listing {
                selectedListing = listing
            }
        } catch {
            guard loadID == threadLoadID else { return }
            // A failed reload keeps the thread on screen. A thread that never loaded shows the error.
            if selectedThread?.id != id {
                selectedThread = nil
                selectedListing = nil
            }
            detailErrorMessage = Self.message(for: error, fallback: "Couldn’t load this thread. Refresh and try again.")
        }
    }

    private func resolvedSelectionID(from threads: [OutreachThreadSummary]) -> Int? {
        if let selectedThreadID, threads.contains(where: { $0.id == selectedThreadID }) {
            return selectedThreadID
        }
        return threads.first?.id
    }

    /// The server's message for an API failure, and `fallback` for an error that carries none.
    private static func message(for error: Error, fallback: String) -> String {
        error is APIError ? AppErrorPresentation.message(for: error) : fallback
    }
}
