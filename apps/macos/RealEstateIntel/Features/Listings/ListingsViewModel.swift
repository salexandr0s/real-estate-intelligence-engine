import CoreLocation
import Foundation
import MapKit
import os

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

    // MARK: - Map

    var isMapMode: Bool = false
    var focusedMapCoordinate: CLLocationCoordinate2D?
    var mapFocusTrigger: Int = 0

    // MARK: - Spatial Selection

    var isDrawingSelection: Bool = false
    var selectionRegion: MKCoordinateRegion?

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

        // Spatial selection (draw-to-search)
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
        || selectionRegion != nil
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
            Log.ui.info("Fetched \(response.listings.count) listings, cursor: \(response.nextCursor ?? "nil", privacy: .public)")
        } catch {
            // Show detailed decode error, not just localized description
            errorMessage = String(describing: error)
            Log.ui.error("Fetch error: \(error, privacy: .public)")
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
        selectionRegion = nil
        isDrawingSelection = false
    }

    func selectListing(_ listing: Listing) {
        selectedListingID = listing.id
    }

    func exportCSV(using client: APIClient) async -> Data? {
        var query = ListingQuery()
        if let d = selectedDistrict { query.districts = [d] }
        if let p = selectedPropertyType { query.propertyTypes = [p.rawValue] }
        if let o = selectedOperationType { query.operationType = o.rawValue }
        if let min = Int(minPrice) { query.minPriceEur = min }
        if let max = Int(maxPrice) { query.maxPriceEur = max }
        if let score = Double(minScore) { query.minScore = score }

        do {
            return try await client.exportListingsCSV(query: query)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }
}
