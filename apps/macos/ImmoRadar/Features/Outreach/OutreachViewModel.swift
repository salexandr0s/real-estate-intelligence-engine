import Foundation

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
    var actionInFlight: String?
    var pageErrorMessage: String?
    var detailErrorMessage: String?
    var hasLoaded = false
    private var nextCursor: String?

    var selectedMailbox: MailboxAccount? { mailboxes.first }

    func refresh(using client: APIClient) async {
        isLoadingList = true
        pageErrorMessage = nil

        do {
            async let mailboxRows = client.fetchMailboxes()
            async let threadResult = client.fetchOutreachThreads(scope: selectedScope)
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
            pageErrorMessage = mailboxErrorMessage(for: error)
            hasLoaded = true
        }

        isLoadingList = false
    }

    func setScope(_ scope: OutreachScope, using client: APIClient) async {
        guard selectedScope != scope else { return }
        selectedScope = scope
        await refresh(using: client)
    }

    func selectThread(id: Int, using client: APIClient) async {
        guard selectedThreadID != id || selectedThread == nil else { return }
        selectedThreadID = id
        await loadThread(id: id, using: client)
    }

    func openThread(id: Int, using client: APIClient) async {
        selectedScope = .all

        if mailboxes.isEmpty || !threads.contains(where: { $0.id == id }) {
            isLoadingList = true
            pageErrorMessage = nil

            do {
                async let mailboxRows = client.fetchMailboxes()
                async let threadResult = client.fetchOutreachThreads(scope: .all)
                let (loadedMailboxes, loadedThreadsResult) = try await (mailboxRows, threadResult)

                mailboxes = loadedMailboxes
                threads = loadedThreadsResult.threads
                nextCursor = loadedThreadsResult.nextCursor
                hasLoaded = true
            } catch {
                pageErrorMessage = mailboxErrorMessage(for: error)
            }

            isLoadingList = false
        }

        selectedThreadID = id
        await loadThread(id: id, using: client)
    }

    func syncPrimaryMailbox(using client: APIClient) async {
        guard let mailbox = selectedMailbox else { return }
        isSyncingMailbox = true
        pageErrorMessage = nil

        do {
            try await client.syncMailbox(id: mailbox.id)
            await refresh(using: client)
        } catch {
            pageErrorMessage = "Mailbox sync failed. Try again in a moment."
        }

        isSyncingMailbox = false
    }

    func reloadSelectedThread(using client: APIClient) async {
        guard let selectedThreadID else {
            await refresh(using: client)
            return
        }
        await loadThread(id: selectedThreadID, using: client)
    }

    func performThreadAction(_ action: OutreachAction, using client: APIClient) async {
        guard let thread = selectedThread else { return }
        actionInFlight = action.rawValue
        detailErrorMessage = nil

        do {
            try await client.updateOutreachThread(id: thread.id, action: action)
            await refresh(using: client)
        } catch {
            detailErrorMessage = actionErrorMessage(for: action)
        }

        actionInFlight = nil
    }

    func sendFollowup(using client: APIClient) async {
        guard let thread = selectedThread else { return }
        actionInFlight = "followup"
        detailErrorMessage = nil

        do {
            try await client.sendOutreachFollowup(id: thread.id)
            await refresh(using: client)
        } catch {
            detailErrorMessage = "Couldn’t queue the follow-up. Check the thread state and try again."
        }

        actionInFlight = nil
    }

    private func loadThread(id: Int, using client: APIClient) async {
        isLoadingThread = true
        detailErrorMessage = nil

        do {
            let loadedThread = try await client.fetchOutreachThread(id: id)
            selectedThread = loadedThread
            do {
                selectedListing = try await client.fetchListing(id: loadedThread.listingId)
            } catch {
                selectedListing = nil
            }
        } catch {
            selectedThread = nil
            selectedListing = nil
            detailErrorMessage = "Couldn’t load this thread. Refresh and try again."
        }

        isLoadingThread = false
    }

    private func resolvedSelectionID(from threads: [OutreachThreadSummary]) -> Int? {
        if let selectedThreadID, threads.contains(where: { $0.id == selectedThreadID }) {
            return selectedThreadID
        }
        return threads.first?.id
    }

    private func mailboxErrorMessage(for error: Error) -> String {
        "Outreach is currently unavailable. Check mailbox configuration and try again."
    }

    private func actionErrorMessage(for action: OutreachAction) -> String {
        switch action {
        case .pause:
            return "Couldn’t pause this thread. Try again in a moment."
        case .resume:
            return "Couldn’t resume this thread. Try again in a moment."
        case .close:
            return "Couldn’t close this thread. Try again in a moment."
        case .retry:
            return "Couldn’t retry this thread. Try again in a moment."
        }
    }
}
