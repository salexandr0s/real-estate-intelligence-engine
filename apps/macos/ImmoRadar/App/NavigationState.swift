import SwiftUI

@MainActor @Observable
final class NavigationState {
    var selectedNavItem: NavigationItem = .dashboard
    var deepLinkListingId: Int?
    var deepLinkOutreachThreadId: Int?

    /// Goes up by one for each Refresh Data request. Feature views reload when it changes.
    private(set) var refreshGeneration = 0

    func navigateTo(_ item: NavigationItem) {
        selectedNavItem = item
    }

    func openListing(_ listingId: Int) {
        deepLinkListingId = listingId
        selectedNavItem = .listings
    }

    func openOutreachThread(_ threadId: Int) {
        deepLinkOutreachThreadId = threadId
        selectedNavItem = .outreach
    }

    func requestRefresh() {
        refreshGeneration += 1
    }
}
