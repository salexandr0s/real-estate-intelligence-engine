import Foundation

// MARK: - Vienna Districts

/// All 23 Vienna districts for district-aware UI surfaces.
enum ViennaDistricts {
    static let all: [(number: Int, name: String)] = [
        (1, "Innere Stadt"), (2, "Leopoldstadt"), (3, "Landstrasse"),
        (4, "Wieden"), (5, "Margareten"), (6, "Mariahilf"),
        (7, "Neubau"), (8, "Josefstadt"), (9, "Alsergrund"),
        (10, "Favoriten"), (11, "Simmering"), (12, "Meidling"),
        (13, "Hietzing"), (14, "Penzing"), (15, "Rudolfsheim-Fuenfhaus"),
        (16, "Ottakring"), (17, "Hernals"), (18, "Waehring"),
        (19, "Doebling"), (20, "Brigittenau"), (21, "Floridsdorf"),
        (22, "Donaustadt"), (23, "Liesing"),
    ]

    static func name(for districtNo: Int) -> String? {
        all.first(where: { $0.number == districtNo })?.name
    }

    static func label(for districtNo: Int) -> String {
        guard let name = name(for: districtNo) else {
            return "District \(districtNo)"
        }
        return "\(districtNo). \(name)"
    }

    static func shortName(for districtNo: Int) -> String {
        switch districtNo {
        case 1: "Innere Stadt"
        case 2: "Leopoldstadt"
        case 3: "Landstrasse"
        case 4: "Wieden"
        case 5: "Margareten"
        case 6: "Mariahilf"
        case 7: "Neubau"
        case 8: "Josefstadt"
        case 9: "Alsergrund"
        case 10: "Favoriten"
        case 11: "Simmering"
        case 12: "Meidling"
        case 13: "Hietzing"
        case 14: "Penzing"
        case 15: "Rudolfsheim-Fhf."
        case 16: "Ottakring"
        case 17: "Hernals"
        case 18: "Waehring"
        case 19: "Doebling"
        case 20: "Brigittenau"
        case 21: "Floridsdorf"
        case 22: "Donaustadt"
        case 23: "Liesing"
        default: name(for: districtNo) ?? "District \(districtNo)"
        }
    }
}
