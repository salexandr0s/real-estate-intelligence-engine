import Foundation

/// View model for the watchlist / saved listings feature.
@MainActor @Observable
final class WatchlistViewModel {
    /// Saved listings per request. The server takes 1 to 200.
    static let pageSize = 50

    var savedListings: [SavedListingItem] = []
    var isLoading = false
    /// The cursor of the page being loaded, nil when no page is loading.
    private(set) var loadingPageCursor: String?
    /// True after the next page failed to load, until it is asked for again.
    var nextPageFailed = false
    /// A failed load of the list.
    var errorMessage: String?
    /// A failed unsave or note save. It shows even while the global banner does.
    var actionErrorMessage: String?
    var savingNotesListingId: Int?
    private(set) var nextCursor: String?

    /// Cursors requested since the first page. A cursor the server hands back again ends paging,
    /// so a repeated cursor can't loop or add the same rows twice.
    @ObservationIgnored private var requestedCursors: Set<String> = []

    /// Goes up with each refresh, so a page requested before it is dropped.
    @ObservationIgnored private var listGeneration = 0

    var hasMorePages: Bool { nextCursor != nil }

    var isLoadingNextPage: Bool { loadingPageCursor != nil }

    func filteredSavedListings(matching searchText: String) -> [SavedListingItem] {
        guard !searchText.isEmpty else { return savedListings }

        return savedListings.filter { item in
            item.listing.title.localizedStandardContains(searchText)
            || (item.listing.districtName ?? "").localizedStandardContains(searchText)
            || (item.notes ?? "").localizedStandardContains(searchText)
        }
    }

    /// Loads the first page again. Later pages load as the user reaches the end of the list.
    func refresh(using client: APIClient) async {
        listGeneration += 1
        let generation = listGeneration
        // A page asked for before this refresh is dropped on arrival, so it may be asked for again.
        if let abandonedCursor = loadingPageCursor {
            requestedCursors.remove(abandonedCursor)
            loadingPageCursor = nil
        }
        isLoading = true
        errorMessage = nil

        do {
            let page = try await client.fetchSavedListingsPage(cursor: nil, limit: Self.pageSize)
            guard generation == listGeneration else { return }
            savedListings = []
            append(page.items)
            requestedCursors = []
            nextCursor = page.nextCursor
            nextPageFailed = false
        } catch {
            guard generation == listGeneration else { return }
            errorMessage = AppErrorPresentation.message(for: error)
        }

        isLoading = false
    }

    /// Loads the page after the rows already shown, if the server said there is one.
    func loadNextPage(using client: APIClient) async {
        guard let cursor = nextCursor, !isLoading, loadingPageCursor == nil else { return }
        guard requestedCursors.insert(cursor).inserted else {
            // The server returned a cursor it already gave, so there is nothing new after it.
            nextCursor = nil
            return
        }

        let generation = listGeneration
        loadingPageCursor = cursor
        nextPageFailed = false

        do {
            let page = try await client.fetchSavedListingsPage(cursor: cursor, limit: Self.pageSize)
            guard generation == listGeneration else { return }
            append(page.items)
            // A cursor that was already asked for means the server is repeating itself: stop here.
            if let next = page.nextCursor, !requestedCursors.contains(next) {
                nextCursor = next
            } else {
                nextCursor = nil
            }
        } catch {
            guard generation == listGeneration else { return }
            // The same page may be asked for again after a failure.
            requestedCursors.remove(cursor)
            nextPageFailed = true
            errorMessage = AppErrorPresentation.message(for: error)
        }

        loadingPageCursor = nil
    }

    func unsave(listingId: Int, using client: APIClient, undoManager: UndoManager? = nil) async {
        let removedItem = savedListings.first { $0.listingId == listingId }
        actionErrorMessage = nil
        do {
            try await client.unsaveListing(listingId: listingId)
            savedListings.removeAll { $0.listingId == listingId }
            // Register undo: re-save the listing and refresh
            if removedItem != nil {
                undoManager?.registerUndo(withTarget: self) { vm in
                    Task { @MainActor in
                        try? await client.saveListing(listingId: listingId, notes: removedItem?.notes)
                        await vm.refresh(using: client)
                    }
                }
                undoManager?.setActionName("Remove from Watchlist")
            }
        } catch {
            actionErrorMessage = AppErrorPresentation.message(for: error)
        }
    }

    func saveNotes(for listingId: Int, notes: String?, using client: APIClient) async {
        guard let index = savedListings.firstIndex(where: { $0.listingId == listingId }) else { return }

        let previousNotes = savedListings[index].notes
        let normalizedNotes = notes?.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextNotes = normalizedNotes?.isEmpty == true ? nil : normalizedNotes

        savingNotesListingId = listingId
        savedListings[index].notes = nextNotes
        actionErrorMessage = nil

        do {
            try await client.saveListing(listingId: listingId, notes: nextNotes)
        } catch {
            if let rollbackIndex = savedListings.firstIndex(where: { $0.listingId == listingId }) {
                savedListings[rollbackIndex].notes = previousNotes
            }
            actionErrorMessage = AppErrorPresentation.message(for: error)
        }

        savingNotesListingId = nil
    }

    func exportCSV(using client: APIClient) async throws -> Data {
        try await client.requestRawData(.exportSavedListings)
    }

    /// Adds rows that aren't shown yet, keeping the server's order.
    private func append(_ items: [SavedListingItem]) {
        var shownIDs = Set(savedListings.map(\.id))
        savedListings.append(contentsOf: items.filter { shownIDs.insert($0.id).inserted })
    }
}
