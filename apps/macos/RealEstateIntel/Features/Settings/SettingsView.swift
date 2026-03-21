import SwiftUI

struct SettingsView: View {
    var body: some View {
        ContentUnavailableView(
            "Settings",
            systemImage: "gear",
            description: Text("Application settings will appear here.")
        )
    }
}
