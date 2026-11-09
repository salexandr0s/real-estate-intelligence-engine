import Foundation
import SwiftUI

/// A single data point in a district price trend over time.
struct DistrictTrendPoint: Identifiable, Codable, Sendable {
    let districtNo: Int
    let date: String
    let avgMedianPpsqm: Double
    let totalSamples: Int
    let avgP25: Double?
    let avgP75: Double?

    var id: String { "\(districtNo)-\(date)" }

    /// The Vienna calendar day the server sends ("2026-03-01"), as the start of that day here.
    var parsedDate: Date? {
        Date.fromCalendarDay(date)
    }

    var districtLabel: String {
        ViennaDistricts.label(for: districtNo)
    }
}

/// Market temperature for a single district based on listing velocity.
struct MarketTemperaturePoint: Identifiable, Codable, Sendable {
    let districtNo: Int
    let newLast7d: Int
    let newLast30d: Int
    let totalActive: Int
    let currentAvgPpsqm: Double
    let velocity: Double
    let temperature: String

    var id: Int { districtNo }

    var temperatureColor: Color {
        switch temperature {
        case "hot": .red
        case "warm": .orange
        case "cool": .blue
        default: .gray
        }
    }

    var temperatureLabel: String {
        temperature.capitalized
    }

    var districtLabel: String {
        ViennaDistricts.label(for: districtNo)
    }
}
