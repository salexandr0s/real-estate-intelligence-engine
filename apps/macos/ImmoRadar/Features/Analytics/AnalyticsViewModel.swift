import Foundation

/// View model for market analytics with baseline pricing data.
@MainActor @Observable
final class AnalyticsViewModel {

    // MARK: - State

    var baselines: [MarketBaseline] = []
    var trendData: [DistrictTrendPoint] = []
    var temperatureData: [MarketTemperaturePoint] = []
    var isLoading: Bool = false
    var hasCompletedInitialLoad: Bool = false
    /// Why each data set's last fetch failed, so the screen doesn't call that data empty.
    private(set) var loadErrors: [DataSet: String] = [:]

    enum DataSet: Hashable {
        case baselines, trends, temperature
    }

    /// The first load error, in the order the data sets load.
    var errorMessage: String? {
        loadErrors[.baselines] ?? loadErrors[.trends] ?? loadErrors[.temperature]
    }

    func hasData(for dataSet: DataSet) -> Bool {
        switch dataSet {
        case .baselines: !baselines.isEmpty
        case .trends: !trendData.isEmpty
        case .temperature: !temperatureData.isEmpty
        }
    }

    // MARK: - Computed

    var totalListings: Int {
        baselines.reduce(0) { $0 + $1.sampleSize }
    }

    var averagePricePerSqm: Double {
        let values = districtBreakdown.compactMap(\.medianPpsqmEur)
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }

    var districtsWithDataCount: Int {
        districtBreakdown.filter(\.hasData).count
    }

    var isInitialLoading: Bool {
        !hasCompletedInitialLoad
    }

    /// District-level breakdown aggregating across area/room buckets.
    /// Always returns the full 23 Vienna districts in numeric order.
    var districtBreakdown: [DistrictSummary] {
        let grouped = Dictionary(grouping: baselines.compactMap { baseline -> MarketBaseline? in
            guard baseline.districtNo != nil else { return nil }
            return baseline
        }) { $0.districtNo ?? 0 }

        let temperatureByDistrict = Dictionary(uniqueKeysWithValues: temperatureData.map { ($0.districtNo, $0) })

        return ViennaDistricts.all.map { district in
            let items = grouped[district.number] ?? []
            let totalSamples = items.reduce(0) { $0 + $1.sampleSize }
            let weightedMedian = weightedAverage(
                values: items.map { ($0.medianPpsqmEur, $0.sampleSize) }
            )
            let weightedP25 = weightedAverage(
                values: items.compactMap { item in
                    guard let p25 = item.p25PpsqmEur else { return nil }
                    return (p25, item.sampleSize)
                }
            )
            let weightedP75 = weightedAverage(
                values: items.compactMap { item in
                    guard let p75 = item.p75PpsqmEur else { return nil }
                    return (p75, item.sampleSize)
                }
            )
            let temperature = temperatureByDistrict[district.number]

            return DistrictSummary(
                districtNo: district.number,
                districtName: district.name,
                medianPpsqmEur: weightedMedian,
                p25PpsqmEur: weightedP25,
                p75PpsqmEur: weightedP75,
                sampleCount: totalSamples,
                velocity: temperature?.velocity,
                temperature: temperature?.temperature
            )
        }
    }

    // MARK: - Actions

    func refresh(using client: APIClient) async {
        isLoading = true
        loadErrors = [:]
        defer {
            isLoading = false
            hasCompletedInitialLoad = true
        }

        do {
            baselines = try await client.fetchBaselines()
        } catch {
            loadErrors[.baselines] = AppErrorPresentation.message(for: error)
        }

        do {
            trendData = try await client.fetchDistrictTrends()
        } catch {
            loadErrors[.trends] = AppErrorPresentation.message(for: error)
        }

        do {
            temperatureData = try await client.fetchMarketTemperature()
        } catch {
            loadErrors[.temperature] = AppErrorPresentation.message(for: error)
        }
    }

    func districtSummary(for districtNo: Int?) -> DistrictSummary? {
        guard let districtNo else {
            return districtBreakdown.first(where: \.hasData) ?? districtBreakdown.first
        }
        return districtBreakdown.first(where: { $0.districtNo == districtNo })
    }

    // MARK: - Helpers

    private func weightedAverage(values: [(Double, Int)]) -> Double? {
        let weightedSamples = values.filter { $0.1 > 0 }
        let totalWeight = weightedSamples.reduce(0) { $0 + $1.1 }
        guard totalWeight > 0 else { return nil }

        let weightedValue = weightedSamples.reduce(0.0) { partial, entry in
            partial + (entry.0 * Double(entry.1))
        }
        return weightedValue / Double(totalWeight)
    }
}
