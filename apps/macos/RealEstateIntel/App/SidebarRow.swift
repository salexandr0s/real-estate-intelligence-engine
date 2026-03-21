import SwiftUI

/// Single sidebar navigation row with optional alert badge.
struct SidebarRow: View {
    let item: NavigationItem
    let unreadAlertCount: Int

    var body: some View {
        Label {
            HStack {
                Text(item.title)
                Spacer()
                if item == .alerts && unreadAlertCount > 0 {
                    Text("\(unreadAlertCount)")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.red, in: Capsule())
                }
            }
        } icon: {
            Image(systemName: item.icon)
        }
        .tag(item)
    }
}
