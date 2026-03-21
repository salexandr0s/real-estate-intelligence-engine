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
        KeyPathComparator(\.currentScore, order: .reverse)
    ]

    // MARK: - Computed

    var filteredListings: [Listing] {
        var result = listings

        // Text search
        if !searchText.isEmpty {
            result = result.filter { listing in
                listing.title.localizedStandardContains(searchText)
                || listing.districtName.localizedStandardContains(searchText)
                || listing.postalCode.localizedStandardContains(searchText)
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
            result = result.filter { $0.currentScore >= score }
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
            if seen.insert(listing.districtNo).inserted {
                result.append((listing.districtNo, listing.districtName))
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

    func loadMockData() {
        listings = Listing.samples
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil

        try? await Task.sleep(for: .milliseconds(300))
        loadMockData()

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
