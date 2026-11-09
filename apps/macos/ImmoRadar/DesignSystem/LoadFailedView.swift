import SwiftUI

/// Takes the place of a screen's empty state when its load failed and nothing is loaded, so the
/// screen never claims there is nothing to show.
struct LoadFailedView: View {
    let title: String
    /// Why the load failed, or nil while the app's connection banner already says.
    let message: String?
    let onRetry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: "exclamationmark.triangle")
        } description: {
            if let message {
                Text(message)
            }
        } actions: {
            Button("Try Again", action: onRetry)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
