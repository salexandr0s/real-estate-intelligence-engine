import Foundation

// MARK: - Top-Level Analysis Response

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

// MARK: - Summary

struct AnalysisSummary: Codable, Sendable {
    let headline: String?
    let keyFacts: [String]
}

// MARK: - Location Context

struct AnalysisLocationContext: Codable, Sendable {
    let districtNo: Int?
    let districtName: String?
    let nearestTransit: String?
    let nearestTransitDistanceM: Double?
    let parksNearby: Int
    let schoolsNearby: Int
}

// MARK: - Building Context

struct AnalysisBuildingContext: Codable, Sendable {
    let buildingFactId: Int
    let matchConfidence: String
    let yearBuilt: Int?
    let typology: String?
    let unitCount: Int?
    let source: String
    let sourceUpdatedAt: String?
}

// MARK: - Market Sale Context

struct AnalysisMarketContext: Codable, Sendable {
    let fallbackLevel: String
    let sampleSize: Int
    let medianPpsqm: Int?
    let p25Ppsqm: Int?
    let p75Ppsqm: Int?
    let confidence: String
}

// MARK: - Market Rent Estimate

struct AnalysisMarketRentEstimate: Codable, Sendable {
    let estimateLow: Double?
    let estimateMid: Double?
    let estimateHigh: Double?
    let eurPerSqmMid: Double?
    let fallbackLevel: String
    let sampleSize: Int
    let confidence: String
}

// MARK: - Investor Metrics

struct AnalysisInvestorMetrics: Codable, Sendable {
    let grossYield: GrossYield
    let priceToRent: Double?
    let sensitivityBands: SensitivityBands

    struct GrossYield: Codable, Sendable {
        let value: Double?
        let assumptions: [String]
    }

    struct SensitivityBands: Codable, Sendable {
        let low: Double?
        let base: Double?
        let high: Double?
    }
}

// MARK: - Legal-Rent Summary

struct AnalysisLegalRentSummary: Codable, Sendable {
    let status: String
    let regimeCandidate: String?
    let confidence: String
    let strongSignals: [LegalRentSignal]
    let weakSignals: [LegalRentSignal]
    let missingFacts: [String]
    let reviewRequired: Bool
    let indicativeBandLow: Double?
    let indicativeBandHigh: Double?
    let disclaimer: String

    struct LegalRentSignal: Codable, Sendable {
        let signal: String
        let source: String
    }
}

// MARK: - Confidence

struct AnalysisConfidence: Codable, Sendable {
    let level: String
    let degradationReasons: [String]
}
