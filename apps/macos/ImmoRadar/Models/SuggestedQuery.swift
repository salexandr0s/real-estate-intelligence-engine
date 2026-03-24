import Foundation

/// A suggested query shown when the copilot conversation is empty.
struct SuggestedQuery: Identifiable {
    let label: String
    let query: String

    var id: String { label }
}
