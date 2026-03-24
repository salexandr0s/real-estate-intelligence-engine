import SwiftUI

/// Centralized design tokens for the ImmoRadar app.
/// All colors, spacing, and visual constants live here.
enum Theme {

    // MARK: - Score Colors

    /// Returns a color for a score value on the 0-100 scale.
    static func scoreColor(for score: Double) -> Color {
        switch score {
        case 80...: .scoreExcellent
        case 60..<80: .scoreGood
        case 30..<60: .scoreAverage
        default: .scorePoor
        }
    }

    /// Returns a text label for a score range.
    static func scoreLabel(for score: Double) -> String {
        switch score {
        case 80...: "Excellent"
        case 60..<80: "Good"
        case 30..<60: "Average"
        default: "Low"
        }
    }

    // MARK: - Source Health Colors

    static func healthColor(for status: SourceHealthStatus) -> Color {
        switch status {
        case .healthy: .sourceHealthy
        case .degraded: .sourceDegraded
        case .failing: .sourceFailing
        case .disabled: .sourceDisabled
        case .unknown: .secondary
        }
    }

    // MARK: - Alert Type Colors

    static func alertColor(for alertType: AlertType) -> Color {
        switch alertType {
        case .newMatch: .accentColor
        case .priceDrop: .scoreGood
        case .scoreUpgrade: .scoreGood
        case .scoreDowngrade: .sourceDegraded
        case .statusChange: .secondary
        }
    }

    // MARK: - Confidence Colors

    /// Maps a confidence level string (high/medium/low) to a semantic color.
    static func confidenceColor(for level: String) -> Color {
        switch level.lowercased() {
        case "high", "exact": .green
        case "medium": .orange
        case "low": .red
        default: .secondary
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
        static let xl: CGFloat = 24
    }

    // MARK: - Chart Typography

    /// Standard font for chart axis labels — semantic replacement for .system(size: 9).
    static var chartAxisFont: Font { .caption2 }

    /// Standard font for chart annotations — semantic replacement for .system(size: 8).monospacedDigit().
    static var chartAnnotationFont: Font { .caption2.monospacedDigit() }

    // MARK: - Card Style

    static let cardBackground = Color(nsColor: .controlBackgroundColor)

    /// Slightly elevated surface for the input bar — distinct from window background.
    static let inputBarBackground = Color(nsColor: .unemphasizedSelectedContentBackgroundColor)
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
