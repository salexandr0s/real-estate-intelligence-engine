import SwiftUI

struct FiltersView: View {
    var body: some View {
        ContentUnavailableView(
            "Filters",
            systemImage: "line.3.horizontal.decrease.circle",
            description: Text("Saved search filters will appear here.")
        )
    }
}
