import SwiftUI

/// Circular score indicator with color coding based on score range.
struct ScoreIndicator: View {
    let score: Double
    let size: Size

    enum Size {
        case compact
        case regular
        case large

        var diameter: CGFloat {
            switch self {
            case .compact: return 32
            case .regular: return 44
            case .large: return 80
            }
        }

        var lineWidth: CGFloat {
            switch self {
            case .compact: return 3
            case .regular: return 4
            case .large: return 6
            }
        }

        var font: Font {
            switch self {
            case .compact: return .caption2.monospacedDigit().bold()
            case .regular: return .caption.monospacedDigit().bold()
            case .large: return .title2.monospacedDigit().bold()
            }
        }
    }

    init(score: Double, size: Size = .regular) {
        self.score = score
        self.size = size
    }

    private var progress: Double {
        min(max(score / 100.0, 0), 1.0)
    }

    private var color: Color {
        Theme.scoreColor(for: score)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.2), lineWidth: size.lineWidth)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(color, style: StrokeStyle(lineWidth: size.lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(String(format: "%.0f", score))
                .font(size.font)
                .foregroundStyle(color)
        }
        .frame(width: size.diameter, height: size.diameter)
    }
}

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
            GeometryReader { geo in
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
                Text(String(format: "%.0f", score))
                    .font(.caption.monospacedDigit().bold())
                    .foregroundStyle(color)
                    .frame(width: 28, alignment: .trailing)
            }
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        HStack(spacing: 20) {
            ScoreIndicator(score: 92, size: .compact)
            ScoreIndicator(score: 75, size: .regular)
            ScoreIndicator(score: 45, size: .large)
            ScoreIndicator(score: 18, size: .large)
        }

        VStack(spacing: 8) {
            ScoreBar(score: 92)
            ScoreBar(score: 75)
            ScoreBar(score: 45)
            ScoreBar(score: 18)
        }
        .frame(width: 200)
    }
    .padding()
}
