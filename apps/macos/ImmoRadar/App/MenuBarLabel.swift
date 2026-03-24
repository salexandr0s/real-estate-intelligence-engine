import SwiftUI

/// Menu bar extra label showing building icon and unread count.
struct MenuBarLabel: View {
    let unreadAlertCount: Int

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "building.2")
            if unreadAlertCount > 0 {
                Text("\(unreadAlertCount)")
                    .font(.caption.monospacedDigit())
            }
        }
    }
}
