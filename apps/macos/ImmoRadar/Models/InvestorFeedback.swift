import Foundation

/// Investor feedback/rating for a listing.
struct InvestorFeedback: Codable, Sendable {
    let id: Int
    let listingId: Int
    let rating: String
    let notes: String?
    let createdAt: String
    let updatedAt: String
}

/// Feedback rating categories.
enum FeedbackRating: String, CaseIterable, Sendable {
    case interested
    case notInterested = "not_interested"
    case bookmarked
    case contacted

    var displayName: String {
        switch self {
        case .interested: "Interested"
        case .notInterested: "Not Interested"
        case .bookmarked: "Bookmarked"
        case .contacted: "Contacted"
        }
    }

    var icon: String {
        switch self {
        case .interested: "hand.thumbsup"
        case .notInterested: "hand.thumbsdown"
        case .bookmarked: "star"
        case .contacted: "phone"
        }
    }

    var filledIcon: String {
        switch self {
        case .interested: "hand.thumbsup.fill"
        case .notInterested: "hand.thumbsdown.fill"
        case .bookmarked: "star.fill"
        case .contacted: "phone.fill"
        }
    }
}
