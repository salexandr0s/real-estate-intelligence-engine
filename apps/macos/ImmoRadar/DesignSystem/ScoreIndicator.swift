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
            case .compact: 32
            case .regular: 44
            case .large: 80
            }
        }

        var lineWidth: CGFloat {
            switch self {
            case .compact: 3
            case .regular: 4
            case .large: 6
            }
        }

        var font: Font {
            switch self {
            case .compact: .caption.monospacedDigit().bold()
            case .regular: .caption.monospacedDigit().bold()
            case .large: .title2.monospacedDigit().bold()
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
            Text(score, format: .number.precision(.fractionLength(0)))
                .font(size.font)
                .foregroundStyle(color)
        }
        .frame(width: size.diameter, height: size.diameter)
    }
}

#Preview {
    HStack(spacing: 20) {
        ScoreIndicator(score: 92, size: .compact)
        ScoreIndicator(score: 75, size: .regular)
        ScoreIndicator(score: 45, size: .large)
        ScoreIndicator(score: 18, size: .large)
    }
    .padding()
}
