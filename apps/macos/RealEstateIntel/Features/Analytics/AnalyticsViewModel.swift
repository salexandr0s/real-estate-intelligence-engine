import Foundation

/// View model for market analytics with baseline pricing data.
@MainActor @Observable
final class AnalyticsViewModel {

    // MARK: - State

    var baselines: [MarketBaseline] = []
    var isLoading: Bool = false
    var errorMessage: String?

    // MARK: - Computed

    var totalListings: Int {
        baselines.reduce(0) { $0 + $1.sampleSize }
    }

    var averagePrice: Double {
        guard !baselines.isEmpty else { return 0 }
        let total = baselines.reduce(0.0) { $0 + $1.medianPpsqmEur * Double($1.sampleSize) }
        let count = baselines.reduce(0) { $0 + $1.sampleSize }
        guard count > 0 else { return 0 }
        return total / Double(count)
    }

    var averagePricePerSqm: Double {
        guard !baselines.isEmpty else { return 0 }
        let total = baselines.reduce(0.0) { $0 + $1.medianPpsqmEur }
        return total / Double(baselines.count)
    }

    /// District-level breakdown aggregating across area/room buckets.
    var districtBreakdown: [DistrictSummary] {
        let grouped = Dictionary(grouping: baselines) { $0.districtNo ?? 0 }
        return grouped.map { districtNo, items in
            let totalSamples = items.reduce(0) { $0 + $1.sampleSize }
            let weightedMedian = items.reduce(0.0) {
                $0 + $1.medianPpsqmEur * Double($1.sampleSize)
            } / max(Double(totalSamples), 1)
            let weightedP25 = items.compactMap { b -> Double? in
                guard let p25 = b.p25PpsqmEur else { return nil }
                return p25 * Double(b.sampleSize)
            }.reduce(0.0, +) / max(Double(totalSamples), 1)

            return DistrictSummary(
                districtNo: districtNo,
                medianPpsqmEur: weightedMedian,
                p25PpsqmEur: weightedP25,
                sampleCount: totalSamples
            )
        }
        .sorted { $0.districtNo < $1.districtNo }
    }

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        isLoading = true
        errorMessage = nil

        do {
            baselines = try await client.fetchBaselines()
        } catch {
            errorMessage = error.localizedDescription
            if baselines.isEmpty {
                baselines = MarketBaseline.samples
            }
        }

        isLoading = false
    }
}

// MARK: - District Summary

struct DistrictSummary: Identifiable {
    let districtNo: Int
    let medianPpsqmEur: Double
    let p25PpsqmEur: Double
    let sampleCount: Int

    var id: Int { districtNo }

    var districtLabel: String {
        districtNo == 0 ? "City-wide" : "District \(districtNo)"
    }
}
