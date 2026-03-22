import SwiftUI

/// Horizontal bar-style score indicator, alternative to circular.
struct ScoreBar: View {
    let score: Double
    let showLabel: Bool

    init(score: Double, showLabel: Bool = true) {
        self.score = score
        self.showLabel = showLabel
    }

    private var progress: Double {
        min(max(score / 100.0, 0), 1.0)
    }

    private var color: Color {
        Theme.scoreColor(for: score)
    }

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            GeometryReader { geo in // Needed for fractional width; no simpler alternative
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(color.opacity(0.2))
                    RoundedRectangle(cornerRadius: 3)
                        .fill(color)
                        .frame(width: geo.size.width * progress)
                }
            }
            .frame(height: 6)

            if showLabel {
                Text(score, format: .number.precision(.fractionLength(0)))
                    .font(.caption.monospacedDigit().bold())
                    .foregroundStyle(color)
                    .frame(width: 28, alignment: .trailing)
            }
        }
    }
}

#Preview {
    VStack(spacing: 8) {
        ScoreBar(score: 92)
        ScoreBar(score: 75)
        ScoreBar(score: 45)
        ScoreBar(score: 18)
    }
    .frame(width: 200)
    .padding()
}
