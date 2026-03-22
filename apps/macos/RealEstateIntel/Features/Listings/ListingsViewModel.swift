import Foundation

/// View model for the listings table with sorting, filtering, and search.
@MainActor @Observable
final class ListingsViewModel {

    // MARK: - State

    var listings: [Listing] = []
    var selectedListingID: Int?
    var searchText: String = ""
    var isLoading: Bool = false
    var isLoadingMore: Bool = false
    var errorMessage: String?
    var nextCursor: String?

    // MARK: - Filters

    var selectedDistrict: Int? = nil
    var selectedPropertyType: PropertyType? = nil
    var selectedOperationType: OperationType? = nil
    var minPrice: String = ""
    var maxPrice: String = ""
    var minScore: String = ""

    // MARK: - Alert Match Tracking

    /// Set of listing IDs that have matching alerts (fetched once on refresh).
    var alertedListingIds: Set<Int> = []

    // MARK: - Sorting

    var sortOrder: [KeyPathComparator<Listing>] = [
        KeyPathComparator(\.sortableScore, order: .reverse)
    ]

    // MARK: - Computed

    var hasMore: Bool { nextCursor != nil }

    var filteredListings: [Listing] {
        var result = listings

        // Text search
        if !searchText.isEmpty {
            result = result.filter { listing in
                listing.title.localizedStandardContains(searchText)
                || (listing.districtName ?? "").localizedStandardContains(searchText)
                || (listing.postalCode ?? "").localizedStandardContains(searchText)
                || listing.city.localizedStandardContains(searchText)
            }
        }

        // District filter
        if let district = selectedDistrict {
            result = result.filter { $0.districtNo == district }
        }

        // Property type filter
        if let propType = selectedPropertyType {
            result = result.filter { $0.propertyType == propType }
        }

        // Operation type filter
        if let opType = selectedOperationType {
            result = result.filter { $0.operationType == opType }
        }

        // Price range
        if let min = Int(minPrice) {
            result = result.filter { $0.listPriceEur >= min }
        }
        if let max = Int(maxPrice) {
            result = result.filter { $0.listPriceEur <= max }
        }

        // Min score
        if let score = Double(minScore) {
            result = result.filter { ($0.currentScore ?? 0) >= score }
        }

        // Apply sort
        result.sort(using: sortOrder)

        return result
    }

    var selectedListing: Listing? {
        guard let id = selectedListingID else { return nil }
        return listings.first { $0.id == id }
    }

    var availableDistricts: [(number: Int, name: String)] {
        var seen = Set<Int>()
        var result: [(number: Int, name: String)] = []
        for listing in listings {
            guard let districtNo = listing.districtNo else { continue }
            if seen.insert(districtNo).inserted {
                result.append((districtNo, listing.districtName ?? "District \(districtNo)"))
            }
        }
        return result.sorted { $0.number < $1.number }
    }

    var hasActiveFilters: Bool {
        selectedDistrict != nil
        || selectedPropertyType != nil
        || selectedOperationType != nil
        || !minPrice.isEmpty
        || !maxPrice.isEmpty
        || !minScore.isEmpty
    }

    // MARK: - Cache Key

    private static let listingsCacheKey = "listings_page_1"

    // MARK: - Actions

    func refresh(using client: APIClient, cache: LocalCache? = nil) async {
        isLoading = true
        errorMessage = nil
        nextCursor = nil

        // Check cache first
        if let cache, let cached = cache.get(Self.listingsCacheKey, as: [Listing].self) {
            listings = cached
            isLoading = false
            // Still refresh alert badges
            await refreshAlertBadges(using: client)
            return
        }

        do {
            let response = try await client.fetchListingsPaginated(query: ListingQuery())
            listings = response.listings
            nextCursor = response.nextCursor
            cache?.set(Self.listingsCacheKey, value: listings)
            NSLog("[ListingsVM] Fetched %d listings, cursor: %@", response.listings.count, response.nextCursor ?? "nil")
        } catch {
            // Show detailed decode error, not just localized description
            errorMessage = String(describing: error)
            NSLog("[ListingsVM] Fetch error: %@", String(describing: error))
        }

        // Fetch alerts to cross-reference listing IDs for badge display
        await refreshAlertBadges(using: client)

        isLoading = false
    }

    /// Fetches alert listing IDs and marks matching listings with alert badges.
    private func refreshAlertBadges(using client: APIClient) async {
        do {
            let alerts = try await client.fetchAlerts(query: AlertQuery())
            alertedListingIds = Set(alerts.compactMap(\.listingId))
            for index in listings.indices {
                listings[index].hasAlertMatch = alertedListingIds.contains(listings[index].id)
            }
        } catch {
            // Non-critical: badges simply won't show
        }
    }

    func loadMore(using client: APIClient) async {
        guard let cursor = nextCursor, !isLoadingMore else { return }

        isLoadingMore = true

        do {
            var query = ListingQuery()
            query.cursor = cursor
            let response = try await client.fetchListingsPaginated(query: query)
            // Deduplicate by ID before appending
            let existingIDs = Set(listings.map(\.id))
            let newListings = response.listings.filter { !existingIDs.contains($0.id) }
            listings.append(contentsOf: newListings)
            nextCursor = response.nextCursor
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoadingMore = false
    }

    func clearFilters() {
        selectedDistrict = nil
        selectedPropertyType = nil
        selectedOperationType = nil
        minPrice = ""
        maxPrice = ""
        minScore = ""
    }

    func selectListing(_ listing: Listing) {
        selectedListingID = listing.id
    }
}
