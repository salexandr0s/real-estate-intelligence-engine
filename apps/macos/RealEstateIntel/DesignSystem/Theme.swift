import SwiftUI

/// Centralized design tokens for the Real Estate Intel app.
/// All colors, spacing, and visual constants live here.
enum Theme {

    // MARK: - Score Colors

    /// Returns a color for a score value on the 0-100 scale.
    static func scoreColor(for score: Double) -> Color {
        switch score {
        case 80...: return .scoreExcellent
        case 60..<80: return .scoreGood
        case 30..<60: return .scoreAverage
        default: return .scorePoor
        }
    }

    /// Returns a text label for a score range.
    static func scoreLabel(for score: Double) -> String {
        switch score {
        case 80...: return "Excellent"
        case 60..<80: return "Good"
        case 30..<60: return "Average"
        default: return "Low"
        }
    }

    // MARK: - Source Health Colors

    static func healthColor(for status: SourceHealthStatus) -> Color {
        switch status {
        case .healthy: return .sourceHealthy
        case .degraded: return .sourceDegraded
        case .failing: return .sourceFailing
        case .disabled: return .sourceDisabled
        case .unknown: return .secondary
        }
    }

    // MARK: - Alert Type Colors

    static func alertColor(for alertType: AlertType) -> Color {
        switch alertType {
        case .newMatch: return .accentColor
        case .priceDrop: return .scoreExcellent
        case .scoreUpgrade: return .scoreGood
        case .scoreDowngrade: return .sourceDegraded
        case .statusChange: return .secondary
        }
    }

    // MARK: - Spacing

    enum Spacing {
        static let xxs: CGFloat = 2
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
        static let xxxl: CGFloat = 48
    }

    // MARK: - Corner Radii

    enum Radius {
        static let sm: CGFloat = 4
        static let md: CGFloat = 8
        static let lg: CGFloat = 12
    }

    // MARK: - Card Style

    static let cardBackground = Color(nsColor: .controlBackgroundColor)
    static let cardShadowRadius: CGFloat = 2
    static let cardShadowY: CGFloat = 1
}

// MARK: - Custom Colors

extension Color {
    // Score range colors
    static let scoreExcellent = Color.blue
    static let scoreGood = Color.green
    static let scoreAverage = Color.orange
    static let scorePoor = Color.red

    // Source health colors
    static let sourceHealthy = Color.green
    static let sourceDegraded = Color.orange
    static let sourceFailing = Color.red
    static let sourceDisabled = Color.gray
}

// MARK: - View Modifiers

struct CardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(Theme.Spacing.lg)
            .background(Theme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .shadow(color: .black.opacity(0.06), radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardModifier())
    }
}
