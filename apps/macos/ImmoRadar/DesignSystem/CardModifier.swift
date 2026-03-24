import SwiftUI

// MARK: - View Modifiers

struct CardModifier: ViewModifier {
    var padding: CGFloat = Theme.Spacing.lg
    var cornerRadius: CGFloat = Theme.Radius.lg

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Theme.cardBackground)
            .clipShape(.rect(cornerRadius: cornerRadius))
            .shadow(color: .black.opacity(0.06), radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
    }
}

extension View {
    func cardStyle(padding: CGFloat = Theme.Spacing.lg, cornerRadius: CGFloat = Theme.Radius.lg) -> some View {
        modifier(CardModifier(padding: padding, cornerRadius: cornerRadius))
    }
}
