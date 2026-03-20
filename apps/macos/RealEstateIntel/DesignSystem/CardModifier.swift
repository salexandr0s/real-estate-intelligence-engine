import SwiftUI

// MARK: - View Modifiers

struct CardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(Theme.Spacing.lg)
            .background(Theme.cardBackground)
            .clipShape(.rect(cornerRadius: Theme.Radius.lg))
            .shadow(color: .black.opacity(0.06), radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardModifier())
    }
}
