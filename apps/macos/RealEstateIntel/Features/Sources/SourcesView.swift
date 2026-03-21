import SwiftUI

struct SourcesView: View {
    var body: some View {
        ContentUnavailableView(
            "Sources",
            systemImage: "globe",
            description: Text("Data source status will appear here.")
        )
    }
}
