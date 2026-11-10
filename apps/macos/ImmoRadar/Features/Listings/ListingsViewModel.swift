import CoreLocation
import CoreSpotlight
import Foundation
import MapKit
import os

/// View model for the listings table with sorting, filtering, and search.
@MainActor @Observable
final class ListingsViewModel {

    // MARK: - State

    var listings: [Listing] = [] {
        didSet { rebuildFilteredListings() }
    }
    var selectedListingID: Int?
    var searchText: String = "" {
        didSet { rebuildFilteredListings() }
    }
    var isLoading: Bool = false
    var hasLoaded: Bool = false
    var errorMessage: String?

    /// Goes up with each refresh, so a slower earlier refresh can't overwrite a newer one.
    @ObservationIgnored private var latestRefreshID = 0

    // MARK: - Filters

    var selectedDistrict: Int? = nil {
        didSet { rebuildFilteredListings() }
    }
    var selectedPropertyType: PropertyType? = nil {
        didSet { rebuildFilteredListings() }
    }
    var selectedOperationType: OperationType? = nil {
        didSet { rebuildFilteredListings() }
    }
    var minPrice: String = "" {
        didSet { rebuildFilteredListings() }
    }
    var maxPrice: String = "" {
        didSet { rebuildFilteredListings() }
    }
    var minScore: String = "" {
        didSet { rebuildFilteredListings() }
    }

    // MARK: - Alert Match Tracking

    /// Set of listing IDs that have matching alerts (fetched once on refresh).
    var alertedListingIds: Set<Int> = []

    // MARK: - Map

    var isMapMode: Bool = false
    var focusedMapCoordinate: CLLocationCoordinate2D?
    var mapFocusTrigger: Int = 0

    // MARK: - Spatial Selection

    var isDrawingSelection: Bool = false
    var selectionRegion: MKCoordinateRegion? {
        didSet { rebuildFilteredListings() }
    }

    // MARK: - Sorting

    var sortOrder: [KeyPathComparator<Listing>] = [
        KeyPathComparator(\.sortableScore, order: .reverse)
    ] {
        didSet { rebuildFilteredListings() }
    }

    // MARK: - Computed

    var filteredListings: [Listing] = []

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
        || selectionRegion != nil
    }

    // MARK: - Cache Key

    private static let listingsCacheKey = "listings_page_1"

    // MARK: - Actions

    /// Loads every listing. The screen's first load may use the copy cached in the last
    /// 300 seconds; an explicit refresh passes `bypassingCache` so it always asks the server.
    func refresh(using client: APIClient, cache: LocalCache? = nil, bypassingCache: Bool = false) async {
        latestRefreshID += 1
        let refreshID = latestRefreshID
        isLoading = true
        errorMessage = nil

        if !bypassingCache, let cache, let cached = cache.get(Self.listingsCacheKey, as: [Listing].self) {
            listings = cached
            hasLoaded = true
            isLoading = false
            // Still refresh alert badges
            await refreshAlertBadges(using: client, refreshID: refreshID)
            return
        }

        do {
            // The map needs every listing, so this follows the cursor through all pages.
            let all = try await Self.fetchAllPages { cursor in
                var query = ListingQuery()
                query.limit = 200
                query.cursor = cursor
                return try await client.fetchListingsPaginated(query: query)
            }
            guard refreshID == latestRefreshID else { return }

            listings = all
            cache?.set(Self.listingsCacheKey, value: listings)
            SpotlightIndexer.shared.indexListings(all)
            Log.ui.info("Fetched all \(all.count) listings")
        } catch {
            guard refreshID == latestRefreshID else { return }
            errorMessage = AppErrorPresentation.message(for: error)
            Log.ui.error("Fetch error: \(error, privacy: .public)")
        }

        // Fetch alerts to cross-reference listing IDs for badge display
        await refreshAlertBadges(using: client, refreshID: refreshID)
        guard refreshID == latestRefreshID else { return }

        hasLoaded = true
        isLoading = false
    }

    /// Follows `nextCursor` from the first page until the server stops sending one. It stops
    /// when the server hands back a cursor it already gave, so a repeated cursor can't loop,
    /// and a listing that is already loaded isn't added again.
    static func fetchAllPages(
        _ fetchPage: (_ cursor: String?) async throws -> (listings: [Listing], nextCursor: String?)
    ) async throws -> [Listing] {
        var all: [Listing] = []
        var loadedIDs = Set<Int>()
        var usedCursors = Set<String>()
        var cursor: String?

        while true {
            let page = try await fetchPage(cursor)
            for listing in page.listings where loadedIDs.insert(listing.id).inserted {
                all.append(listing)
            }
            guard let next = page.nextCursor, usedCursors.insert(next).inserted else {
                return all
            }
            cursor = next
        }
    }

    /// Fetches alert listing IDs and marks matching listings with alert badges.
    private func refreshAlertBadges(using client: APIClient, refreshID: Int) async {
        do {
            let alerts = try await client.fetchAlerts(query: AlertQuery())
            guard refreshID == latestRefreshID else { return }
            alertedListingIds = Set(alerts.compactMap(\.listingId))
            var updatedListings = listings
            for index in updatedListings.indices {
                updatedListings[index].hasAlertMatch = alertedListingIds.contains(updatedListings[index].id)
            }
            listings = updatedListings
        } catch {
            // Non-critical: badges simply won't show
        }
    }

    func clearFilters() {
        selectedDistrict = nil
        selectedPropertyType = nil
        selectedOperationType = nil
        minPrice = ""
        maxPrice = ""
        minScore = ""
        selectionRegion = nil
        isDrawingSelection = false
    }

    func selectListing(_ listing: Listing) {
        selectedListingID = listing.id
    }

    func revealListing(id: Int) {
        searchText = ""
        clearFilters()
        isMapMode = false
        selectedListingID = id
    }

    /// Throws, so the view reports a failed export as the user's own action rather than as a
    /// failed load.
    func exportCSV(using client: APIClient) async throws -> Data {
        var query = ListingQuery()
        if let d = selectedDistrict { query.districts = [d] }
        if let p = selectedPropertyType { query.propertyTypes = [p.rawValue] }
        if let o = selectedOperationType { query.operationType = o.rawValue }
        if let min = Int(minPrice) { query.minPriceEur = min }
        if let max = Int(maxPrice) { query.maxPriceEur = max }
        if let score = Double(minScore) { query.minScore = score }

        return try await client.exportListingsCSV(query: query)
    }

    private func rebuildFilteredListings() {
        filteredListings = applyFilters(to: listings)
    }

    private func applyFilters(to sourceListings: [Listing]) -> [Listing] {
        var result = sourceListings

        if !searchText.isEmpty {
            result = result.filter { listing in
                listing.title.localizedStandardContains(searchText)
                || (listing.districtName ?? "").localizedStandardContains(searchText)
                || (listing.postalCode ?? "").localizedStandardContains(searchText)
                || listing.city.localizedStandardContains(searchText)
            }
        }

        if let district = selectedDistrict {
            result = result.filter { $0.districtNo == district }
        }

        if let propType = selectedPropertyType {
            result = result.filter { $0.propertyType == propType }
        }

        if let opType = selectedOperationType {
            result = result.filter { $0.operationType == opType }
        }

        if let min = Int(minPrice) {
            result = result.filter {
                guard let price = $0.listPriceEur else { return false }
                return price >= min
            }
        }

        if let max = Int(maxPrice) {
            result = result.filter {
                guard let price = $0.listPriceEur else { return false }
                return price <= max
            }
        }

        if let score = Double(minScore) {
            result = result.filter { ($0.currentScore ?? 0) >= score }
        }

        if let region = selectionRegion {
            let latMin = region.center.latitude - region.span.latitudeDelta / 2
            let latMax = region.center.latitude + region.span.latitudeDelta / 2
            let lonMin = region.center.longitude - region.span.longitudeDelta / 2
            let lonMax = region.center.longitude + region.span.longitudeDelta / 2
            result = result.filter { listing in
                guard let c = listing.coordinate else { return false }
                return c.latitude >= latMin && c.latitude <= latMax
                    && c.longitude >= lonMin && c.longitude <= lonMax
            }
        }

        result.sort(using: sortOrder)
        return result
    }
}
