import CoreSpotlight
import Foundation

/// Indexes listings in Spotlight so users can find them via Cmd+Space.
final class SpotlightIndexer: Sendable {
    static let shared = SpotlightIndexer()
    private let domainID = "com.immoradar.listings"

    private init() {}

    /// Index an array of listings for Spotlight search.
    func indexListings(_ listings: [Listing]) {
        let items = listings.map { listing -> CSSearchableItem in
            let attrs = CSSearchableItemAttributeSet(contentType: .content)
            attrs.title = listing.title
            attrs.contentDescription = [
                listing.districtName,
                listing.city,
                listing.postalCode,
                PriceFormatter.format(eur: listing.listPriceEur),
            ]
            .compactMap { $0 }
            .joined(separator: " · ")
            attrs.keywords = [
                listing.sourceCode,
                listing.operationType.rawValue,
                listing.propertyType.rawValue,
                listing.districtName,
            ].compactMap { $0 }
            return CSSearchableItem(
                uniqueIdentifier: "listing-\(listing.id)",
                domainIdentifier: domainID,
                attributeSet: attrs
            )
        }
        CSSearchableIndex.default().indexSearchableItems(items)
    }

    /// Remove all indexed listings.
    func deindexAll() {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [domainID])
    }

    /// Extract a listing ID from a Spotlight user activity.
    static func listingID(from activity: NSUserActivity) -> Int? {
        guard activity.activityType == CSSearchableItemActionType,
              let identifier = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
              identifier.hasPrefix("listing-") else {
            return nil
        }
        return Int(identifier.dropFirst("listing-".count))
    }
}
