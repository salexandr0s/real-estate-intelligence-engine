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
    /// Threads per request.
    static let pageSize = 25
    /// The most threads the server returns for one request.
    static let maxPageSize = 200

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
    /// Each thread's last failed request, kept until that thread's next request or Dismiss. A
    /// request can fail after the user picked another thread, so the view reads
    /// `shownActionFailure`.
    private var actionFailures: [Int: OutreachRequestFailure] = [:]
    var hasLoaded = false
    /// The cursor of the next page of threads, nil on the last page.
    private(set) var nextCursor: String?
    /// True while the next page of threads loads.
    private(set) var isLoadingMoreThreads = false
    /// Why the next page of threads didn't load.
    private(set) var moreThreadsErrorMessage: String?
    /// Goes up with every list load, so an earlier, slower load can't replace the list shown now.
    @ObservationIgnored private var listLoadID = 0
    /// The scope of the threads shown, nil while no list is shown.
    @ObservationIgnored private var listScope: OutreachScope?
    /// The cursor of the page of more threads loading now.
    @ObservationIgnored private var loadingMoreCursor: String?
    /// Cursors asked for since the first page. A cursor the server hands back again ends paging.
    @ObservationIgnored private var requestedCursors: Set<String> = []
    /// Goes up with every thread load, so an earlier, slower load can't replace the thread shown now.
    @ObservationIgnored private var threadLoadID = 0
    /// The thread a load is fetching, so selecting it again doesn't fetch it twice.
    @ObservationIgnored private var threadIDInFlight: Int?

    var selectedMailbox: MailboxAccount? { mailboxes.first }

    /// The failed request of the thread that is selected and on screen. Try Again sends it for the
    /// thread on screen, so another thread's failure mustn't show.
    var shownActionFailure: OutreachRequestFailure? {
        guard let thread = selectedThread, thread.id == selectedThreadID else { return nil }
        return actionFailures[thread.id]
    }

    func refresh(using client: any OutreachAPIClient) async {
        // Reloading the scope shown keeps the user's place in it.
        let keepsPlace = listScope == selectedScope
        guard await loadList(using: client) else { return }
        let loadID = listLoadID

        // A thread missing from the reloaded list may sit on a page not loaded yet, so it stays
        // selected while the server has more.
        await select(resolvedSelectionID(keepsUnlistedSelection: keepsPlace && nextCursor != nil), using: client)

        // Unless the thread left the scope, as a thread closed from Open does. Then the
        // selection moves on, as it does on the last page.
        if loadID == listLoadID, let scope = listScope, let thread = selectedThread,
           thread.id == selectedThreadID, !scope.includes(thread),
           !threads.contains(where: { $0.id == thread.id }) {
            await select(threads.first?.id, using: client)
        }
    }

    /// Loads a thread picked in the list. The list's selection binding has already set
    /// `selectedThreadID`, so this compares against the thread on screen and the one loading.
    func selectThread(id: Int, using client: any OutreachAPIClient) async {
        guard threadIDInFlight != id else { return }
        // Picking the thread on screen again while another thread loads reloads it, so the
        // slower load can't replace it.
        guard selectedThread?.id != id || threadIDInFlight != nil else { return }
        selectedThreadID = id
        await loadThread(id: id, using: client)
    }

    func openThread(id: Int, using client: any OutreachAPIClient) async {
        // A list of another scope that's still loading would replace the All list shown, so
        // the All list counts as shown only while no load is out.
        let showsAll = listScope == .all && selectedScope == .all && !isLoadingList
        selectedScope = .all

        // Load the All list unless it's already shown with the thread in it. The load replaces
        // any list still loading.
        if !showsAll || mailboxes.isEmpty || !threads.contains(where: { $0.id == id }) {
            await loadList(using: client)
        }

        selectedThreadID = id
        await loadThread(id: id, using: client)
    }

    /// Loads the threads after the ones shown, when the server has more.
    func loadMoreThreads(using client: any OutreachAPIClient) async {
        // The cursor belongs to the list shown, so the page comes from that list's scope.
        guard let cursor = nextCursor, let scope = listScope, !isLoadingList, !isLoadingMoreThreads else { return }
        guard requestedCursors.insert(cursor).inserted else {
            // The server handed back a cursor it already gave, so nothing new follows it.
            nextCursor = nil
            return
        }

        let loadID = listLoadID
        loadingMoreCursor = cursor
        isLoadingMoreThreads = true
        moreThreadsErrorMessage = nil
        defer {
            if loadID == listLoadID {
                isLoadingMoreThreads = false
                loadingMoreCursor = nil
            }
        }

        do {
            let page = try await client.fetchOutreachThreads(scope: scope, cursor: cursor, limit: Self.pageSize)
            guard loadID == listLoadID else { return }
            var shownIDs = Set(threads.map(\.id))
            threads.append(contentsOf: page.threads.filter { shownIDs.insert($0.id).inserted })
            nextCursor = page.nextCursor.flatMap { requestedCursors.contains($0) ? nil : $0 }
        } catch {
            guard loadID == listLoadID else { return }
            // The same page may be asked for again.
            requestedCursors.remove(cursor)
            moreThreadsErrorMessage = Self.message(for: error, fallback: "Couldn’t load more threads. Try again.")
        }
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
        guard let failure = shownActionFailure, failure.canTryAgain else { return }
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
        guard let thread = selectedThread else { return }
        actionFailures[thread.id] = nil
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
        actionFailures[thread.id] = nil

        do {
            try await operation(thread.id)
            await refresh(using: client)
        } catch {
            let failure = OutreachRequestFailure(request: request, error: error)
            actionFailures[thread.id] = failure
            if failure.isConflict {
                await refresh(using: client)
            }
        }

        actionInFlight = nil
    }

    /// Loads the mailboxes and the first page of threads in the selected scope. A reload of the
    /// scope shown asks for as many threads as it shows, so pages added with Load More stay
    /// listed. Returns false when the load failed or a newer one replaced it.
    @discardableResult
    private func loadList(using client: any OutreachAPIClient) async -> Bool {
        listLoadID += 1
        let loadID = listLoadID
        let scope = selectedScope
        let limit = scope == listScope ? min(max(Self.pageSize, threads.count), Self.maxPageSize) : Self.pageSize
        isLoadingList = true
        // A page of more threads still loading belongs to the list this load replaces, so its
        // cursor may be asked for again.
        if let cursor = loadingMoreCursor {
            requestedCursors.remove(cursor)
            loadingMoreCursor = nil
        }
        isLoadingMoreThreads = false
        moreThreadsErrorMessage = nil
        pageErrorMessage = nil
        defer {
            if loadID == listLoadID { isLoadingList = false }
        }

        do {
            async let mailboxRows = client.fetchMailboxes()
            async let threadPage = client.fetchOutreachThreads(scope: scope, cursor: nil, limit: limit)
            let (loadedMailboxes, loadedPage) = try await (mailboxRows, threadPage)
            guard loadID == listLoadID else { return false }

            mailboxes = loadedMailboxes
            threads = loadedPage.threads
            listScope = scope
            nextCursor = loadedPage.nextCursor
            requestedCursors = []
            hasLoaded = true
            return true
        } catch {
            guard loadID == listLoadID else { return false }
            if scope != listScope {
                // The threads shown belong to another scope, so the failure shows in their place.
                threads = []
                nextCursor = nil
                listScope = nil
            }
            pageErrorMessage = Self.message(
                for: error,
                fallback: "Outreach is currently unavailable. Check mailbox configuration and try again."
            )
            hasLoaded = true
            return false
        }
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

    /// Selects the thread with `id` and loads it, or clears the detail for nil.
    private func select(_ id: Int?, using client: any OutreachAPIClient) async {
        selectedThreadID = id

        if let id {
            await loadThread(id: id, using: client)
        } else {
            selectedThread = nil
            selectedListing = nil
            detailErrorMessage = nil
        }
    }

    /// The thread to select after a list load: the selected one while it's listed or
    /// `keepsUnlistedSelection` is true, otherwise the first one listed.
    private func resolvedSelectionID(keepsUnlistedSelection: Bool) -> Int? {
        if let selectedThreadID,
           keepsUnlistedSelection || threads.contains(where: { $0.id == selectedThreadID }) {
            return selectedThreadID
        }
        return threads.first?.id
    }

    /// The server's message for an API failure, and `fallback` for an error that carries none.
    private static func message(for error: Error, fallback: String) -> String {
        error is APIError ? AppErrorPresentation.message(for: error) : fallback
    }
}
