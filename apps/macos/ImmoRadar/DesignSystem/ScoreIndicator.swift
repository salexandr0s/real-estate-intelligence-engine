import SwiftUI

/// Circular score indicator with color coding based on score range. A listing not scored yet
/// shows a dash in a neutral ring, not a score of zero.
struct ScoreIndicator: View {
    let score: Double?
    let size: Size
    @Environment(\.colorSchemeContrast) private var contrast

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

    init(score: Double?, size: Size = .regular) {
        self.score = score
        self.size = size
    }

    private var color: Color {
        guard let score else { return .secondary }
        return Theme.scoreColor(for: score, contrast: contrast)
    }

    private var trackOpacity: Double {
        contrast == .increased ? 0.4 : 0.2
    }

    private var label: String {
        score.map { Theme.scoreLabel(for: $0) } ?? "Not scored"
    }

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                Circle()
                    .stroke(color.opacity(trackOpacity), lineWidth: size.lineWidth)
                if let score {
                    Circle()
                        .trim(from: 0, to: min(max(score / 100.0, 0), 1.0))
                        .stroke(color, style: StrokeStyle(lineWidth: size.lineWidth, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    Text(score, format: .number.precision(.fractionLength(0)))
                        .font(size.font)
                        .foregroundStyle(color)
                } else {
                    Text("—")
                        .font(size.font)
                        .foregroundStyle(color)
                }
            }
            .frame(width: size.diameter, height: size.diameter)

            if size == .large {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(score.map { "Score \(Int($0)), \(label)" } ?? label)
    }
}

#Preview {
    HStack(spacing: 20) {
        ScoreIndicator(score: 92, size: .compact)
        ScoreIndicator(score: 75, size: .regular)
        ScoreIndicator(score: 45, size: .large)
        ScoreIndicator(score: 18, size: .large)
        ScoreIndicator(score: nil, size: .large)
    }
    .padding()
}
