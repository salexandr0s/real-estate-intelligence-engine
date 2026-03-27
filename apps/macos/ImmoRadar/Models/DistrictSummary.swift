import Foundation
import SwiftUI

struct DistrictSummary: Identifiable {
    let districtNo: Int
    let districtName: String
    let medianPpsqmEur: Double?
    let p25PpsqmEur: Double?
    let p75PpsqmEur: Double?
    let sampleCount: Int
    let velocity: Double?
    let temperature: String?

    var id: Int { districtNo }

    var districtLabel: String {
        "\(districtNo). \(districtName)"
    }

    var shortLabel: String {
        "\(districtNo)"
    }

    var snapshotName: String {
        ViennaDistricts.shortName(for: districtNo)
    }

    var hasData: Bool {
        medianPpsqmEur != nil
    }

    var temperatureColor: Color {
        switch temperature {
        case "hot": .red
        case "warm": .orange
        case "cool": .blue
        case "cold": .gray
        default: .secondary
        }
    }

    var temperatureLabel: String {
        temperature?.capitalized ?? "No activity"
    }
}
