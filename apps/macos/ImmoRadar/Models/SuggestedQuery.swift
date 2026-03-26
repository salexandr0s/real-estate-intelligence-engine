import Foundation

/// A suggested query shown when the copilot conversation is empty.
struct SuggestedQuery: Identifiable, Hashable {
    let label: String
    let query: String
    let subtitle: String
    let icon: String

    init(label: String, query: String, subtitle: String, icon: String) {
        self.label = label
        self.query = query
        self.subtitle = subtitle
        self.icon = icon
    }

    var id: String { label }
}
