import Foundation

struct ListingComparisonData: Codable {
    let listings: [CopilotListing]
    let sections: [ListingComparisonSection]
    let callouts: [ComparisonCallout]
}
