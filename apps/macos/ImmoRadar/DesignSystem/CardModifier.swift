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

struct DashboardPanelModifier: ViewModifier {
    var padding: CGFloat = Theme.Spacing.lg
    var cornerRadius: CGFloat = Theme.Dashboard.panelRadius
    var tone: Theme.Dashboard.SemanticTone = .neutral
    var tint: Color? = nil
    var elevated: Bool = false

    func body(content: Content) -> some View {
        let wash = tint ?? Theme.Dashboard.panelWash(for: tone)
        let borderColor = tint?.opacity(0.16) ?? Theme.Dashboard.panelBorderColor(for: tone)

        content
            .padding(padding)
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Theme.cardBackground)
                    .overlay {
                        if let wash {
                            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            wash.opacity(0.10),
                                            wash.opacity(0.04),
                                            .clear,
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                        }
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(borderColor, lineWidth: 0.5)
            }
            .shadow(
                color: .black.opacity(elevated ? 0.12 : 0.05),
                radius: elevated ? 18 : 8,
                y: elevated ? 10 : 4
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

    func dashboardPanelStyle(
        padding: CGFloat = Theme.Spacing.lg,
        cornerRadius: CGFloat = Theme.Dashboard.panelRadius,
        tone: Theme.Dashboard.SemanticTone,
        elevated: Bool = false
    ) -> some View {
        modifier(
            DashboardPanelModifier(
                padding: padding,
                cornerRadius: cornerRadius,
                tone: tone,
                elevated: elevated
            )
        )
    }

    func dashboardPanelStyle(
        padding: CGFloat = Theme.Spacing.lg,
        cornerRadius: CGFloat = Theme.Dashboard.panelRadius,
        tint: Color? = nil,
        elevated: Bool = false
    ) -> some View {
        modifier(
            DashboardPanelModifier(
                padding: padding,
                cornerRadius: cornerRadius,
                tone: .neutral,
                tint: tint,
                elevated: elevated
            )
        )
    }
}
