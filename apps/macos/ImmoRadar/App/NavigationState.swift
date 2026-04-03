import SwiftUI

@MainActor @Observable
final class NavigationState {
    var selectedNavItem: NavigationItem = .dashboard
    var deepLinkListingId: Int?
    var deepLinkOutreachThreadId: Int?

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
}
