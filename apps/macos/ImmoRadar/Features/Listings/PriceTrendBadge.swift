import SwiftUI

/// Small badge showing price change direction and percentage.
struct PriceTrendBadge: View {
    let changePct: Double

    private var isDecrease: Bool { changePct < 0 }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: isDecrease ? "arrow.down.right" : "arrow.up.right")
                .font(.caption.bold())
            let pct = Text(abs(changePct), format: .number.precision(.fractionLength(1)))
            let suffix = Text("%")
            Text("\(pct)\(suffix)")
                .font(.caption.monospacedDigit().bold())
        }
        .foregroundStyle(isDecrease ? .green : .red)
        .padding(.horizontal, 4)
        .padding(.vertical, 1)
        .background(
            (isDecrease ? Color.green : Color.red).opacity(0.1),
            in: RoundedRectangle(cornerRadius: 3)
        )
    }
}
