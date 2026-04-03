import Foundation

struct ListingAnalysis: Codable, Sendable {
    let listingId: Int
    let summary: AnalysisSummary
    let locationContext: AnalysisLocationContext
    let buildingContext: AnalysisBuildingContext?
    let marketSaleContext: AnalysisMarketContext?
    let marketRentContext: AnalysisMarketRentEstimate?
    let investorMetrics: AnalysisInvestorMetrics?
    let riskFlags: [String]
    let upsideFlags: [String]
    let assumptions: [String]
    let missingData: [String]
    let legalRentSummary: AnalysisLegalRentSummary?
    let confidence: AnalysisConfidence
    let computedAt: String
}
