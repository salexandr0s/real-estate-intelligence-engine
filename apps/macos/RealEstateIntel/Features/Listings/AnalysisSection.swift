import SwiftUI

/// Investor analysis section — market rent, investor metrics, building context,
/// legal-rent assessment, risk/upside flags, and confidence model.
struct AnalysisSection: View {
    let analysis: ListingAnalysis?
    let isLoading: Bool

    @State private var isExpanded = true

    var body: some View {
        if isLoading {
            ProgressView("Loading analysis…")
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, Theme.Spacing.md)
        } else if let analysis {
            DisclosureGroup(isExpanded: $isExpanded) {
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    confidenceBadge(analysis.confidence)

                    if let rent = analysis.marketRentContext {
                        marketRentCard(rent)
                    }

                    if let metrics = analysis.investorMetrics {
                        investorMetricsCard(metrics)
                    }

                    if let building = analysis.buildingContext {
                        buildingContextCard(building)
                    }

                    if let sale = analysis.marketSaleContext {
                        saleContextCard(sale)
                    }

                    if let legal = analysis.legalRentSummary {
                        legalRentCard(legal)
                    }

                    if !analysis.riskFlags.isEmpty {
                        flagsSection(title: "Risk Flags", flags: analysis.riskFlags, color: .red)
                    }

                    if !analysis.upsideFlags.isEmpty {
                        flagsSection(title: "Upside Flags", flags: analysis.upsideFlags, color: .green)
                    }

                    if !analysis.missingData.isEmpty {
                        missingDataSection(analysis.missingData)
                    }

                    if !analysis.assumptions.isEmpty {
                        assumptionsSection(analysis.assumptions)
                    }
                }
                .padding(.top, Theme.Spacing.sm)
            } label: {
                Text("Investor Analysis")
                    .font(.headline)
            }
        }
    }

    // MARK: - Confidence Badge

    @ViewBuilder
    private func confidenceBadge(_ confidence: AnalysisConfidence) -> some View {
        HStack(spacing: Theme.Spacing.sm) {
            StatusBadge(
                label: "Confidence: \(confidence.level.capitalized)",
                color: confidenceColor(confidence.level)
            )

            if !confidence.degradationReasons.isEmpty {
                Text(confidence.degradationReasons.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }

    // MARK: - Market Rent Card

    @ViewBuilder
    private func marketRentCard(_ rent: AnalysisMarketRentEstimate) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            sectionLabel("Market Rent Estimate")

            if let mid = rent.estimateMid {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xs) {
                    Text(formatEur(mid))
                        .font(.title3)
                        .fontWeight(.semibold)
                    Text("/month")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: Theme.Spacing.lg) {
                if let low = rent.estimateLow {
                    metricCell("Low", formatEur(low))
                }
                if let high = rent.estimateHigh {
                    metricCell("High", formatEur(high))
                }
                if let psqm = rent.eurPerSqmMid {
                    metricCell("€/m²", String(format: "%.1f", psqm))
                }
            }

            HStack(spacing: Theme.Spacing.sm) {
                StatusBadge(label: rent.confidence.capitalized, color: confidenceColor(rent.confidence))
                Text("\(rent.sampleSize) comps · \(rent.fallbackLevel)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .cardStyle()
    }

    // MARK: - Investor Metrics Card

    @ViewBuilder
    private func investorMetricsCard(_ metrics: AnalysisInvestorMetrics) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            sectionLabel("Investor Metrics")

            HStack(spacing: Theme.Spacing.lg) {
                if let yield = metrics.grossYield.value {
                    metricCell("Gross Yield", String(format: "%.2f%%", yield))
                }
                if let ptr = metrics.priceToRent {
                    metricCell("Price/Rent", String(format: "%.1fx", ptr))
                }
            }

            if metrics.sensitivityBands.low != nil || metrics.sensitivityBands.high != nil {
                HStack(spacing: Theme.Spacing.lg) {
                    if let low = metrics.sensitivityBands.low {
                        metricCell("Yield Low", String(format: "%.2f%%", low))
                    }
                    if let base = metrics.sensitivityBands.base {
                        metricCell("Yield Base", String(format: "%.2f%%", base))
                    }
                    if let high = metrics.sensitivityBands.high {
                        metricCell("Yield High", String(format: "%.2f%%", high))
                    }
                }
            }

            if !metrics.grossYield.assumptions.isEmpty {
                Text(metrics.grossYield.assumptions.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .cardStyle()
    }

    // MARK: - Building Context Card

    @ViewBuilder
    private func buildingContextCard(_ building: AnalysisBuildingContext) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                sectionLabel("Building")
                Spacer()
                StatusBadge(
                    label: building.matchConfidence.capitalized,
                    color: confidenceColor(building.matchConfidence)
                )
            }

            let rows: [(String, String)] = [
                building.yearBuilt.map { ("Year Built", "\($0)") },
                building.typology.map { ("Typology", $0) },
                building.unitCount.map { ("Units", "\($0)") },
                ("Source", building.source),
            ].compactMap { $0 }

            ForEach(rows, id: \.0) { row in
                DetailRow(label: row.0, value: row.1)
            }
        }
        .cardStyle()
    }

    // MARK: - Sale Context Card

    @ViewBuilder
    private func saleContextCard(_ sale: AnalysisMarketContext) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            sectionLabel("Sale Comparables")

            HStack(spacing: Theme.Spacing.lg) {
                if let median = sale.medianPpsqm {
                    metricCell("Median €/m²", formatEurInt(median))
                }
                if let p25 = sale.p25Ppsqm {
                    metricCell("P25", formatEurInt(p25))
                }
                if let p75 = sale.p75Ppsqm {
                    metricCell("P75", formatEurInt(p75))
                }
            }

            HStack(spacing: Theme.Spacing.sm) {
                StatusBadge(label: sale.confidence.capitalized, color: confidenceColor(sale.confidence))
                Text("\(sale.sampleSize) comps · \(sale.fallbackLevel)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .cardStyle()
    }

    // MARK: - Legal-Rent Card

    @ViewBuilder
    private func legalRentCard(_ legal: AnalysisLegalRentSummary) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                sectionLabel("Legal-Rent Assessment")
                Spacer()
                StatusBadge(label: legalStatusLabel(legal.status), color: legalStatusColor(legal.status))
            }

            if let regime = legal.regimeCandidate {
                DetailRow(label: "Regime", value: regime)
            }

            if let low = legal.indicativeBandLow, let high = legal.indicativeBandHigh {
                DetailRow(label: "Indicative Band", value: "\(formatEur(low)) – \(formatEur(high))/m²")
            }

            if !legal.strongSignals.isEmpty {
                signalList("Strong Signals", legal.strongSignals, color: .blue)
            }

            if !legal.weakSignals.isEmpty {
                signalList("Weak Signals", legal.weakSignals, color: .secondary)
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

    // MARK: - Flags Sections

    @ViewBuilder
    private func flagsSection(title: String, flags: [String], color: Color) -> some View {
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

    @ViewBuilder
    private func missingDataSection(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text("Missing Data")
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.orange)

            ForEach(items, id: \.self) { item in
                Text("• \(item)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func assumptionsSection(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text("Assumptions")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fontWeight(.medium)

            ForEach(items, id: \.self) { item in
                Text("• \(item)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .fontWeight(.medium)
    }

    @ViewBuilder
    private func metricCell(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline)
                .fontWeight(.medium)
        }
    }

    @ViewBuilder
    private func signalList(_ title: String, _ signals: [AnalysisLegalRentSummary.LegalRentSignal], color: Color) -> some View {
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

    private func confidenceColor(_ level: String) -> Color {
        switch level.lowercased() {
        case "high", "exact": .green
        case "medium": .orange
        case "low": .red
        default: .secondary
        }
    }

    private func legalStatusLabel(_ status: String) -> String {
        switch status {
        case "likely_capped": "Likely Capped"
        case "likely_uncapped": "Likely Uncapped"
        case "likely_capped_missing_critical_proof": "Capped (Missing Proof)"
        case "unclear": "Unclear"
        case "needs_human_legal_review": "Needs Review"
        default: status.capitalized
        }
    }

    private func legalStatusColor(_ status: String) -> Color {
        switch status {
        case "likely_capped": .orange
        case "likely_uncapped": .green
        case "likely_capped_missing_critical_proof": .red
        case "unclear": .secondary
        case "needs_human_legal_review": .red
        default: .secondary
        }
    }

    private func formatEur(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "EUR"
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "€\(Int(value))"
    }

    private func formatEurInt(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "EUR"
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "€\(value)"
    }
}
