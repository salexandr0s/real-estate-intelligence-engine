import SwiftUI

/// Single score component row with label and bar.
struct ScoreRow: View {
    let label: String
    let value: Double

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 110, alignment: .leading)
            ScoreBar(score: value)
        }
    }
}
