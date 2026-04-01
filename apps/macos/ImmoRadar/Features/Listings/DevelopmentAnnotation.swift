import SwiftUI

/// Map annotation for Wien development projects with hover popover.
struct DevelopmentAnnotation: View {
    let development: WienDevelopment
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovered = false
    @State private var isPopoverPresented = false

    private var showsHoverCard: Bool {
        isHovered && !isPopoverPresented
    }

    var body: some View {
        VStack(spacing: 2) {
            if showsHoverCard {
                DevelopmentPopover(development: development)
                    .transition(.opacity.combined(with: .scale(scale: 0.95, anchor: .bottom)))
                    .zIndex(100)
            }

            Button {
                isPopoverPresented.toggle()
            } label: {
                marker
            }
            .buttonStyle(.plain)
            .popover(isPresented: $isPopoverPresented, arrowEdge: .bottom) {
                DevelopmentPopover(development: development)
            }
            .accessibilityLabel(development.name)
            .accessibilityHint("Shows project details")
        }
        .onHover { isHovered = $0 }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.15), value: isHovered)
    }

    private var marker: some View {
        Image(systemName: "building.2.fill")
            .font(.caption.bold())
            .foregroundStyle(.white)
            .frame(width: 18, height: 18)
            .background(development.statusColor, in: RoundedRectangle(cornerRadius: 3))
            .overlay { RoundedRectangle(cornerRadius: 3).stroke(.white, lineWidth: 0.5) }
    }
}
