import SwiftUI

/// Card showing legal-rent assessment — regime, indicative band, signals, and disclaimer.
struct AnalysisLegalRentCard: View {
    let legal: AnalysisLegalRentSummary

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("Legal-Rent Assessment")
                    .font(.subheadline)
                    .fontWeight(.medium)
                Spacer()
                StatusBadge(label: statusLabel, color: statusColor)
            }

            if let regime = legal.regimeCandidate {
                DetailRow(label: "Regime", value: regime)
            }

            if let low = legal.indicativeBandLow, let high = legal.indicativeBandHigh {
                DetailRow(
                    label: "Indicative Band",
                    value: "\(PriceFormatter.format(eurDouble: low)) – \(PriceFormatter.format(eurDouble: high))/m²"
                )
            }

            if !legal.strongSignals.isEmpty {
                LegalRentSignalList(title: "Strong Signals", signals: legal.strongSignals, color: .blue)
            }

            if !legal.weakSignals.isEmpty {
                LegalRentSignalList(title: "Weak Signals", signals: legal.weakSignals, color: .secondary)
            }

            if !legal.missingFacts.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text("Missing Facts")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    ForEach(legal.missingFacts, id: \.self) { fact in
                        Text("• \(fact)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Text(legal.disclaimer)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .italic()
        }
        .cardStyle()
    }

    // MARK: - Helpers

    private var statusLabel: String {
        switch legal.status {
        case "likely_capped": "Likely Capped"
        case "likely_uncapped": "Likely Uncapped"
        case "likely_capped_missing_critical_proof": "Capped (Missing Proof)"
        case "unclear": "Unclear"
        case "needs_human_legal_review": "Needs Review"
        default: legal.status.capitalized
        }
    }

    private var statusColor: Color {
        switch legal.status {
        case "likely_capped": .orange
        case "likely_uncapped": .green
        case "likely_capped_missing_critical_proof": .red
        case "unclear": .secondary
        case "needs_human_legal_review": .red
        default: .secondary
        }
    }

}
