import Foundation

struct DistrictSummary: Identifiable {
    let districtNo: Int
    let medianPpsqmEur: Double
    let p25PpsqmEur: Double
    let p75PpsqmEur: Double
    let sampleCount: Int

    var id: Int { districtNo }

    var districtLabel: String {
        districtNo == 0 ? "City-wide" : "District \(districtNo)"
    }
}
