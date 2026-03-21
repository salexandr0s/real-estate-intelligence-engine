import SwiftUI

struct AlertsView: View {
    var body: some View {
        ContentUnavailableView(
            "Alerts",
            systemImage: "bell",
            description: Text("Listing alerts will appear here.")
        )
    }
}
