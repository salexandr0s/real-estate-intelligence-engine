import SwiftUI

/// Custom map annotation view showing a score-colored pin with precision indicator.
/// Exact locations show a solid pin. Estimated/approximate locations show a dashed ring.
struct ListingAnnotation: View {
    let listing: Listing
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                if listing.hasExactLocation {
                    // Solid pin for exact coordinates
                    Circle()
                        .fill(scoreColor)
                        .frame(width: pinSize, height: pinSize)
                        .overlay(Circle().stroke(.white, lineWidth: 1.5))
                        .shadow(color: .black.opacity(0.2), radius: isSelected ? 3 : 1, y: 1)
                } else {
                    // Dashed ring for estimated/approximate locations
                    Circle()
                        .fill(scoreColor.opacity(0.3))
                        .frame(width: pinSize + 4, height: pinSize + 4)
                        .overlay(
                            Circle()
                                .stroke(scoreColor, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2]))
                        )
                        .overlay(
                            Circle()
                                .fill(scoreColor)
                                .frame(width: 5, height: 5)
                        )
                        .shadow(color: .black.opacity(0.15), radius: isSelected ? 3 : 1, y: 1)
                }

                if isSelected {
                    Circle()
                        .stroke(scoreColor, lineWidth: 2)
                        .frame(width: pinSize + 10, height: pinSize + 10)
                }
            }

            if isSelected {
                calloutCard
            }
        }
        .animation(.easeInOut(duration: 0.15), value: isSelected)
    }

    private var pinSize: CGFloat { isSelected ? 16 : 10 }

    private var scoreColor: Color {
        Theme.scoreColor(for: listing.currentScore ?? 0)
    }

    private var precisionLabel: String? {
        switch listing.geocodePrecision {
        case "estimated": "Estimated location"
        case "source_approx": "Approximate location"
        case "district": "District area"
        case "city": "City area"
        default: nil
        }
    }

    private var calloutCard: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(listing.title)
                .font(.caption)
                .fontWeight(.medium)
                .lineLimit(2)
                .frame(maxWidth: 180, alignment: .leading)

            HStack(spacing: Theme.Spacing.sm) {
                Text(PriceFormatter.format(eur: listing.listPriceEur))
                    .font(.caption2)
                    .fontWeight(.semibold)

                if let score = listing.currentScore {
                    Text(String(format: "%.0f", score))
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(scoreColor, in: RoundedRectangle(cornerRadius: 3))
                }

                if let district = listing.districtName {
                    Text(district)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            if let precision = precisionLabel {
                HStack(spacing: 3) {
                    Image(systemName: "location.slash")
                        .font(.system(size: 8))
                    Text(precision)
                        .font(.system(size: 9))
                }
                .foregroundStyle(.orange)
            }
        }
        .padding(Theme.Spacing.sm)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
        .shadow(color: .black.opacity(0.1), radius: 4, y: 2)
    }
}

#Preview {
    VStack(spacing: 20) {
        ListingAnnotation(listing: Listing.samples[0], isSelected: false)
        ListingAnnotation(listing: Listing.samples[0], isSelected: true)
    }
    .padding(40)
}
