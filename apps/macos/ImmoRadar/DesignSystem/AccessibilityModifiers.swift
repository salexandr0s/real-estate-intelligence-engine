import SwiftUI

// MARK: - Adaptive Material (Reduce Transparency)

/// Replaces translucent materials with solid backgrounds when Reduce Transparency is enabled.
struct AdaptiveMaterialModifier: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let material: Material
    let solidColor: Color
    let shape: AnyShape

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(solidColor, in: shape)
        } else {
            content.background(material, in: shape)
        }
    }
}

extension View {
    /// Applies a translucent material background, falling back to a solid color when Reduce Transparency is on.
    func adaptiveMaterial(
        _ material: Material,
        solid: Color = Color(nsColor: .windowBackgroundColor),
        in shape: some Shape = Rectangle()
    ) -> some View {
        modifier(AdaptiveMaterialModifier(material: material, solidColor: solid, shape: AnyShape(shape)))
    }
}

// MARK: - Adaptive Font Weight (Bold Text)

/// Bumps font weights up one level when the Bold Text accessibility setting is enabled.
struct AdaptiveFontWeightModifier: ViewModifier {
    @Environment(\.legibilityWeight) private var legibilityWeight
    let baseWeight: Font.Weight

    func body(content: Content) -> some View {
        content.fontWeight(legibilityWeight == .bold ? bumpedWeight : baseWeight)
    }

    private var bumpedWeight: Font.Weight {
        switch baseWeight {
        case .ultraLight: .thin
        case .thin: .light
        case .light: .regular
        case .regular: .medium
        case .medium: .semibold
        case .semibold: .bold
        case .bold: .heavy
        case .heavy: .black
        default: baseWeight
        }
    }
}

extension View {
    /// Applies a font weight that adapts to the Bold Text accessibility setting.
    func adaptiveFontWeight(_ weight: Font.Weight) -> some View {
        modifier(AdaptiveFontWeightModifier(baseWeight: weight))
    }
}

extension Text {
    /// Text-specific overload so `.font(.caption).adaptiveFontWeight(.medium)` compiles
    /// (Text.font() returns Text, which needs its own lookup path to this modifier).
    func adaptiveFontWeight(_ weight: Font.Weight) -> some View {
        modifier(AdaptiveFontWeightModifier(baseWeight: weight))
    }
}

// MARK: - Reduce Motion Helpers

extension View {
    /// Returns the animation when Reduce Motion is off, nil when on.
    /// Usage: `.animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: x)`
    /// This is a documentation helper — the actual check uses the environment directly.
}

/// Wraps `withAnimation` to respect Reduce Motion.
/// Usage: `withAdaptiveAnimation(reduceMotion, .easeInOut(duration: 0.3)) { ... }`
@MainActor
func withAdaptiveAnimation(_ reduceMotion: Bool, _ animation: Animation?, _ body: () -> Void) {
    if reduceMotion {
        body()
    } else {
        withAnimation(animation, body)
    }
}
