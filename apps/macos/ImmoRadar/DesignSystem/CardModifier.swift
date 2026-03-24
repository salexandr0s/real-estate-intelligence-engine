import SwiftUI

// MARK: - Card Variant

enum CardVariant {
    /// Full card with drop shadow — use for primary content panels.
    case standard
    /// Background + clip only, no shadow — use for secondary/operational panels.
    case subtle
}

// MARK: - View Modifiers

struct CardModifier: ViewModifier {
    var variant: CardVariant = .standard
    var padding: CGFloat = Theme.Spacing.lg
    var cornerRadius: CGFloat = Theme.Radius.lg

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Theme.cardBackground)
            .clipShape(.rect(cornerRadius: cornerRadius))
            .shadow(
                color: variant == .standard ? .black.opacity(0.06) : .clear,
                radius: Theme.cardShadowRadius,
                y: Theme.cardShadowY
            )
    }
}

extension View {
    func cardStyle(padding: CGFloat = Theme.Spacing.lg, cornerRadius: CGFloat = Theme.Radius.lg) -> some View {
        modifier(CardModifier(padding: padding, cornerRadius: cornerRadius))
    }

    func cardStyle(_ variant: CardVariant, padding: CGFloat = Theme.Spacing.lg, cornerRadius: CGFloat = Theme.Radius.lg) -> some View {
        modifier(CardModifier(variant: variant, padding: padding, cornerRadius: cornerRadius))
    }
}
