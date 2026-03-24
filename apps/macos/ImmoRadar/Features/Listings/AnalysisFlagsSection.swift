import SwiftUI

/// Colored flag list for risk/upside indicators.
struct AnalysisFlagsList: View {
    let title: String
    let flags: [String]
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(title)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(color)

            ForEach(flags, id: \.self) { flag in
                HStack(spacing: Theme.Spacing.xs) {
                    Circle()
                        .fill(color.opacity(0.6))
                        .frame(width: 6, height: 6)
                    Text(flag)
                        .font(.caption)
                }
            }
        }
        .padding(Theme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.06))
        .clipShape(.rect(cornerRadius: Theme.Radius.md))
    }
}
