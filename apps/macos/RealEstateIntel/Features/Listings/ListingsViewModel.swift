import Foundation

/// View model for the listings table with sorting, filtering, and search.
@MainActor @Observable
final class ListingsViewModel {

    // MARK: - State

    var listings: [Listing] = []
    var selectedListingID: Int?
    var searchText: String = ""
    var isLoading: Bool = false
    var errorMessage: String?

    // MARK: - Filters

    var selectedDistrict: Int? = nil
    var selectedPropertyType: PropertyType? = nil
    var selectedOperationType: OperationType? = nil
    var minPrice: String = ""
    var maxPrice: String = ""
    var minScore: String = ""

    // MARK: - Sorting

    var sortOrder: [KeyPathComparator<Listing>] = [
        KeyPathComparator(\.sortableScore, order: .reverse)
    ]

    // MARK: - Computed

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

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        do {
            listings = try await client.fetchListings(query: ListingQuery())
        } catch {
            errorMessage = error.localizedDescription
            // Fall back to mock data if API unavailable
            if listings.isEmpty {
                listings = Listing.samples
            }
        }

        isLoading = false
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
