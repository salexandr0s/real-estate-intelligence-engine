import CoreLocation
import SwiftUI

/// Data for a group of listings in the same district, shown as a single map bubble.
struct DistrictCluster {
    let districtNo: Int
    let districtName: String?
    let count: Int
    let center: CLLocationCoordinate2D
    let avgScore: Double
}

/// Map annotation bubble showing listing count per district.
/// Tapping zooms the map into that district.
struct ListingClusterBubble: View {
    let count: Int
    let avgScore: Double
    let districtName: String?

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                Circle()
                    .fill(Theme.scoreColor(for: avgScore))
                    .frame(width: bubbleSize, height: bubbleSize)
                    .overlay { Circle().stroke(.white, lineWidth: 2) }
                    .shadow(color: .black.opacity(0.2), radius: 3, y: 1)

                Text("\(count)")
                    .font(.system(size: fontSize, weight: .bold))
                    .foregroundStyle(.white)
                    .monospacedDigit()
            }

            if let name = districtName {
                Text(name)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .adaptiveMaterial(.regularMaterial, in: RoundedRectangle(cornerRadius: 3))
            }
        }
    }

    private var bubbleSize: CGFloat {
        switch count {
        case 0..<5: 28
        case 5..<15: 34
        case 15..<30: 40
        default: 46
        }
    }

    private var fontSize: CGFloat {
        switch count {
        case 0..<5: 11
        case 5..<15: 13
        case 15..<30: 14
        default: 15
        }
    }
}

#Preview {
    HStack(spacing: 20) {
        ListingClusterBubble(count: 3, avgScore: 85, districtName: "Leopoldstadt")
        ListingClusterBubble(count: 12, avgScore: 65, districtName: "Favoriten")
        ListingClusterBubble(count: 27, avgScore: 45, districtName: "Floridsdorf")
    }
    .padding(40)
}
