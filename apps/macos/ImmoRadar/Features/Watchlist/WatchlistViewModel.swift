import Foundation

/// View model for the watchlist / saved listings feature.
@MainActor @Observable
final class WatchlistViewModel {
    var savedListings: [SavedListingItem] = []
    var isLoading = false
    var errorMessage: String?
    private var nextCursor: String?

    func filteredSavedListings(matching searchText: String) -> [SavedListingItem] {
        guard !searchText.isEmpty else { return savedListings }

        return savedListings.filter { item in
            item.listing.title.localizedStandardContains(searchText)
            || (item.listing.districtName ?? "").localizedStandardContains(searchText)
            || (item.notes ?? "").localizedStandardContains(searchText)
        }
    }

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        do {
            let response: PaginatedResponse<SavedListingItem> = try await client.requestPaginated(
                .listSavedListings(limit: 50, cursor: nil)
            )
            savedListings = response.data
            nextCursor = response.meta?.nextCursor
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func unsave(listingId: Int, using client: APIClient, undoManager: UndoManager? = nil) async {
        let removedItem = savedListings.first { $0.listingId == listingId }
        do {
            try await client.requestVoid(.unsaveListing(listingId: listingId))
            savedListings.removeAll { $0.listingId == listingId }
            // Register undo: re-save the listing and refresh
            if removedItem != nil {
                undoManager?.registerUndo(withTarget: self) { vm in
                    Task { @MainActor in
                        try? await client.saveListing(listingId: listingId)
                        await vm.refresh(using: client)
                    }
                }
                undoManager?.setActionName("Remove from Watchlist")
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func exportCSV(using client: APIClient) async -> Data? {
        do {
            return try await client.requestRawData(.exportSavedListings)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }
}
