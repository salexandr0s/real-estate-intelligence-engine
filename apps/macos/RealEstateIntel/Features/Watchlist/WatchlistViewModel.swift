import Foundation

/// View model for the watchlist / saved listings feature.
@MainActor @Observable
final class WatchlistViewModel {
    var savedListings: [SavedListingItem] = []
    var isLoading = false
    var errorMessage: String?
    private var nextCursor: String?

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

    func unsave(listingId: Int, using client: APIClient) async {
        do {
            try await client.requestVoid(.unsaveListing(listingId: listingId))
            savedListings.removeAll { $0.listingId == listingId }
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
