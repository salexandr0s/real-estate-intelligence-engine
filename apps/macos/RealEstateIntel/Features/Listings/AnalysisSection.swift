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
                    AnalysisConfidenceBadge(confidence: analysis.confidence)

                    if let rent = analysis.marketRentContext {
                        AnalysisMarketRentCard(rent: rent)
                    }

                    if let metrics = analysis.investorMetrics {
                        AnalysisInvestorMetricsCard(metrics: metrics)
                    }

                    if let building = analysis.buildingContext {
                        AnalysisBuildingContextCard(building: building)
                    }

                    if let sale = analysis.marketSaleContext {
                        AnalysisSaleContextCard(sale: sale)
                    }

                    if let legal = analysis.legalRentSummary {
                        AnalysisLegalRentCard(legal: legal)
                    }

                    if !analysis.riskFlags.isEmpty {
                        AnalysisFlagsList(title: "Risk Flags", flags: analysis.riskFlags, color: .red)
                    }

                    if !analysis.upsideFlags.isEmpty {
                        AnalysisFlagsList(title: "Upside Flags", flags: analysis.upsideFlags, color: .green)
                    }

                    if !analysis.missingData.isEmpty {
                        AnalysisMissingDataList(items: analysis.missingData)
                    }

                    if !analysis.assumptions.isEmpty {
                        AnalysisAssumptionsList(items: analysis.assumptions)
                    }
                }
                .padding(.top, Theme.Spacing.sm)
            } label: {
                Text("Investor Analysis")
                    .font(.headline)
            }
        }
    }
}
