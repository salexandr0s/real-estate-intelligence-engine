import SwiftUI

/// Map annotation for Wien development projects with hover popover.
struct DevelopmentAnnotation: View {
    let development: WienDevelopment
    @State private var isHovered = false

    var body: some View {
        VStack(spacing: 2) {
            if isHovered {
                DevelopmentPopover(development: development)
                    .transition(.opacity.combined(with: .scale(scale: 0.95, anchor: .bottom)))
                    .zIndex(100)
            }

            marker
        }
        .onHover { isHovered = $0 }
        .animation(.easeInOut(duration: 0.15), value: isHovered)
    }

    private var marker: some View {
        Image(systemName: "building.2.fill")
            .font(.system(size: 8)) // Fixed size: map marker icon
            .foregroundStyle(.white)
            .frame(width: 16, height: 16)
            .background(development.statusColor, in: RoundedRectangle(cornerRadius: 3))
            .overlay { RoundedRectangle(cornerRadius: 3).stroke(.white, lineWidth: 0.5) }
    }
}
