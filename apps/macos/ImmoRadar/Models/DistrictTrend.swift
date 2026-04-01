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

    /// Parse the date string ("2026-03-01") into a Date.
    /// Uses a dedicated formatter without fractional seconds.
    var parsedDate: Date? {
        DistrictTrendPoint.dateFormatter.date(from: date)
    }

    var districtLabel: String {
        ViennaDistricts.label(for: districtNo)
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
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
