import SwiftUI

/// Action buttons for opening a listing URL in the browser or copying it.
struct ListingActionsSection: View {
    let canonicalUrl: String

    var body: some View {
        VStack(spacing: Theme.Spacing.sm) {
            Button {
                if let url = URL(string: canonicalUrl) {
                    NSWorkspace.shared.open(url)
                }
            } label: {
                Label("Open in Browser", systemImage: "safari")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)

            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(canonicalUrl, forType: .string)
            } label: {
                Label("Copy URL", systemImage: "doc.on.doc")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.bordered)
        }
    }
}
