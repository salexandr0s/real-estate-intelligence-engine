import SwiftUI

/// Toolbar buttons for listings view.
struct ListingsToolbar: View {
    @Binding var showInspector: Bool
    let isLoading: Bool
    let onRefresh: () -> Void

    var body: some View {
        Button {
            showInspector.toggle()
        } label: {
            Label("Inspector", systemImage: "sidebar.trailing")
        }
        .help("Toggle listing detail inspector")

        Button(action: onRefresh) {
            Label("Refresh", systemImage: "arrow.clockwise")
        }
        .disabled(isLoading)
        .help("Refresh listings")
    }
}
