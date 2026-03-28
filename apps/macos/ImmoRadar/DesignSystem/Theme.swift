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

    /// Contrast-aware variant for Increase Contrast accessibility setting.
    static func scoreColor(for score: Double, contrast: ColorSchemeContrast) -> Color {
        guard contrast == .increased else { return scoreColor(for: score) }
        switch score {
        case 80...: return Color.scoreExcellentHC
        case 60..<80: return Color.scoreGoodHC
        case 30..<60: return Color.scoreAverageHC
        default: return Color.scorePoorHC
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
        case .blocked: .sourceFailing
        case .disabled: .sourceDisabled
        case .unknown: .secondary
        }
    }

    /// Contrast-aware variant for Increase Contrast accessibility setting.
    static func healthColor(for status: SourceHealthStatus, contrast: ColorSchemeContrast) -> Color {
        guard contrast == .increased else { return healthColor(for: status) }
        switch status {
        case .healthy: return Color.sourceHealthyHC
        case .degraded: return Color.sourceDegradedHC
        case .blocked: return Color.sourceFailingHC
        case .disabled: return Color(nsColor: .systemGray)
        case .unknown: return Color.primary
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

    /// Contrast-aware variant for Increase Contrast accessibility setting.
    static func alertColor(for alertType: AlertType, contrast: ColorSchemeContrast) -> Color {
        guard contrast == .increased else { return alertColor(for: alertType) }
        switch alertType {
        case .newMatch: return Color.accentColor
        case .priceDrop: return Color.scoreGoodHC
        case .scoreUpgrade: return Color.scoreGoodHC
        case .scoreDowngrade: return Color.sourceDegradedHC
        case .statusChange: return Color.primary
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
    static var chartAxisFont: Font { .caption }

    /// Standard font for chart annotations — semantic replacement for .system(size: 8).monospacedDigit().
    static var chartAnnotationFont: Font { .caption.monospacedDigit() }

    // MARK: - Card Style

    static let cardBackground = Color(nsColor: .controlBackgroundColor)

    /// Slightly elevated surface for the input bar — distinct from window background.
    static let inputBarBackground = Color(nsColor: .unemphasizedSelectedContentBackgroundColor)
    static let cardShadowRadius: CGFloat = 2
    static let cardShadowY: CGFloat = 1

    // MARK: - Copilot Layout

    enum Copilot {
        static let railMinWidth: CGFloat = 232
        static let railIdealWidth: CGFloat = 264
        static let railMaxWidth: CGFloat = 304
        static let collapsedHistoryBreakpoint: CGFloat = 900
        static let inlineInspectorBreakpoint: CGFloat = 1220
        static let contentMaxWidth: CGFloat = 920
        static let promptMaxWidth: CGFloat = 720
        static let composerMaxWidth: CGFloat = 740
        static let horizontalPadding: CGFloat = 28
        static let bottomDockPadding: CGFloat = 18
        static let composerRadius: CGFloat = 20
        static let sectionRadius: CGFloat = 18
        static let artifactRadius: CGFloat = 16
        static let historyRowRadius: CGFloat = 14
        static let sessionSpacing: CGFloat = 18
        static let evidenceSpacing: CGFloat = 14
        static let toolbarChipMaxWidth: CGFloat = 400
        static let toolbarChipRadius: CGFloat = 14
    }

    enum Dashboard {
        static let contentMaxWidth: CGFloat = 1380
        static let sectionSpacing: CGFloat = 24
        static let gridSpacing: CGFloat = 18
        static let sideColumnWidth: CGFloat = 360
        static let compactBreakpoint: CGFloat = 980
        static let mediumBreakpoint: CGFloat = 1320
        static let topRowMinHeight: CGFloat = 508
        static let secondaryRowMinHeight: CGFloat = 300
        static let panelRadius: CGFloat = 24
        static let metricMinWidth: CGFloat = 156
        static let trackedFilterMinWidth: CGFloat = 300

        enum SemanticTone {
            case neutral
            case accent
            case score
            case alert
            case positive
            case caution
        }

        static func iconTint(for tone: SemanticTone) -> Color {
            switch tone {
            case .neutral: return .secondary
            case .accent: return .accentColor
            case .score: return .scoreExcellent
            case .alert: return .scorePoor
            case .positive: return .scoreGood
            case .caution: return .scoreAverage
            }
        }

        static func panelWash(for tone: SemanticTone) -> Color? {
            switch tone {
            case .neutral:
                return nil
            case .accent:
                return .accentColor
            case .score:
                return .scoreExcellent
            case .alert:
                return .scorePoor
            case .positive:
                return .scoreGood
            case .caution:
                return .scoreAverage
            }
        }

        static func panelBorderColor(for tone: SemanticTone) -> Color {
            let base = Color(nsColor: .separatorColor).opacity(0.18)
            guard let wash = panelWash(for: tone) else { return base }
            return wash.opacity(0.16)
        }

        static func iconChipBackground(for tone: SemanticTone) -> Color {
            iconTint(for: tone).opacity(tone == .neutral ? 0.08 : 0.12)
        }

        static func badgeBackground(for tone: SemanticTone) -> Color {
            iconTint(for: tone).opacity(tone == .neutral ? 0.08 : 0.14)
        }

        static func tileBackground(for tone: SemanticTone) -> Color {
            iconTint(for: tone).opacity(tone == .neutral ? 0.04 : 0.06)
        }

        static func deltaColor(isPositive: Bool) -> Color {
            isPositive ? .scoreGood : .scorePoor
        }

        static func filterKindTint(isAlert: Bool) -> Color {
            isAlert ? .accentColor : .secondary
        }

        static func filterKindBackground(isAlert: Bool) -> Color {
            filterKindTint(isAlert: isAlert).opacity(isAlert ? 0.14 : 0.08)
        }
    }
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

    // High-contrast variants (Increase Contrast accessibility setting)
    static let scoreExcellentHC = Color(nsColor: .systemBlue)
    static let scoreGoodHC = Color(nsColor: .systemGreen)
    static let scoreAverageHC = Color(nsColor: .systemOrange)
    static let scorePoorHC = Color(nsColor: .systemRed)

    static let sourceHealthyHC = Color(nsColor: .systemGreen)
    static let sourceDegradedHC = Color(nsColor: .systemOrange)
    static let sourceFailingHC = Color(nsColor: .systemRed)
}
