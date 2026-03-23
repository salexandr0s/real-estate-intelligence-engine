import SwiftUI

/// Bullet list of legal-rent signals with a colored title.
struct LegalRentSignalList: View {
    let title: String
    let signals: [AnalysisLegalRentSummary.LegalRentSignal]
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(title)
                .font(.caption)
                .foregroundStyle(color)
            ForEach(signals, id: \.signal) { s in
                Text("• \(s.signal) (\(s.source))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
