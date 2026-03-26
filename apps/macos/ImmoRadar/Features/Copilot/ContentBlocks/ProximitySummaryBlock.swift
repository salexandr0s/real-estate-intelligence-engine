import MapKit
import SwiftUI

struct ProximitySummaryBlock: View {
    let data: ProximitySummaryData

    private let nearestColumns = [
        GridItem(.adaptive(minimum: 170, maximum: 220), spacing: Theme.Spacing.sm)
    ]

    private let countColumns = [
        GridItem(.adaptive(minimum: 170, maximum: 220), spacing: Theme.Spacing.sm)
    ]

    private var mappableNearest: [ProximityNearestItem] {
        data.nearest.filter { $0.coordinate != nil }
    }

    private var primaryHighlights: [ProximityNearestItem] {
        let preferred: [POICategory] = [.ubahn, .tram, .bus, .school, .supermarket, .park]
        var picked: [ProximityNearestItem] = []

        for category in preferred {
            if let item = data.nearest.first(where: { $0.category == category }) {
                picked.append(item)
            }
            if picked.count == 4 { break }
        }

        if picked.count < 4 {
            for item in data.nearest where !picked.contains(where: { $0.id == item.id }) {
                picked.append(item)
                if picked.count == 4 { break }
            }
        }

        return picked
    }

    private var showsMapBand: Bool {
        data.status == .ok && data.listingCoordinate != nil && !mappableNearest.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            header

            switch data.status {
            case .missingCoordinates:
                missingState(
                    icon: "location.slash",
                    title: "Coordinates missing",
                    message: "Geocode this listing to unlock rendered school, transit, and shop distances."
                )
            case .noPois:
                missingState(
                    icon: "map",
                    title: "No nearby results",
                    message: "No amenities were found in the current proximity window."
                )
            case .ok:
                if showsMapBand, let listingCoordinate = data.listingCoordinate {
                    ProximityMapBand(
                        listingCoordinate: listingCoordinate,
                        listingTitle: data.listingTitle,
                        nearest: Array(mappableNearest.prefix(6))
                    )
                }

                SummaryNote(text: data.summary)

                if !primaryHighlights.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Theme.Spacing.sm) {
                            ForEach(primaryHighlights) { item in
                                ProximityHighlightBadge(item: item)
                            }
                        }
                        .padding(.vertical, 1)
                    }
                }

                if !data.nearest.isEmpty {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Nearest evidence")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)

                        LazyVGrid(columns: nearestColumns, alignment: .leading, spacing: Theme.Spacing.sm) {
                            ForEach(data.nearest) { item in
                                ProximityNearestCard(item: item)
                            }
                        }
                    }
                }

                if !data.counts.isEmpty {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Coverage")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)

                        LazyVGrid(columns: countColumns, alignment: .leading, spacing: Theme.Spacing.sm) {
                            ForEach(data.counts) { item in
                                CountChip(item: item)
                            }
                        }
                    }
                }
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Color(nsColor: .separatorColor).opacity(0.22), lineWidth: 0.5)
        }
        .shadow(radius: Theme.cardShadowRadius, y: Theme.cardShadowY)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Label("Location evidence", systemImage: "figure.walk.motion")
                    .font(.subheadline.bold())
                Text(data.listingTitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if let dataSource = data.dataSource {
                Text(dataSource == .live ? "Live" : "Cached")
                    .font(.caption2.bold())
                    .padding(.horizontal, Theme.Spacing.sm)
                    .padding(.vertical, Theme.Spacing.xs)
                    .background(dataSource == .live ? Color.blue.opacity(0.12) : Color.secondary.opacity(0.12), in: Capsule())
            }
        }
    }

    private func missingState(icon: String, title: String, message: String) -> some View {
        HStack(spacing: Theme.Spacing.md) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(title)
                    .font(.caption.bold())
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(Theme.Spacing.sm)
        .background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Color(nsColor: .separatorColor).opacity(0.18), lineWidth: 0.5)
        }
    }
}

private struct ProximityMapBand: View {
    let listingCoordinate: CopilotCoordinate
    let listingTitle: String
    let nearest: [ProximityNearestItem]

    @State private var position: MapCameraPosition = .automatic

    private var region: MKCoordinateRegion {
        let coordinates = [listingCoordinate.locationCoordinate] + nearest.compactMap { $0.coordinate?.locationCoordinate }
        let latitudes = coordinates.map(\.latitude)
        let longitudes = coordinates.map(\.longitude)

        guard let minLat = latitudes.min(),
              let maxLat = latitudes.max(),
              let minLon = longitudes.min(),
              let maxLon = longitudes.max() else {
            return MKCoordinateRegion(
                center: listingCoordinate.locationCoordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.008, longitudeDelta: 0.008)
            )
        }

        let latitudeDelta = max(0.005, (maxLat - minLat) * 1.8)
        let longitudeDelta = max(0.005, (maxLon - minLon) * 1.8)

        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: (minLat + maxLat) / 2,
                longitude: (minLon + maxLon) / 2
            ),
            span: MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
        )
    }

    var body: some View {
        Map(position: $position) {
            Annotation("Listing", coordinate: listingCoordinate.locationCoordinate) {
                VStack(spacing: Theme.Spacing.xxs) {
                    Image(systemName: "house.fill")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .frame(width: 20, height: 20)
                        .background(Color.accentColor, in: Circle())
                    Text("Listing")
                        .font(.caption2.bold())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color(nsColor: .windowBackgroundColor), in: Capsule())
                }
            }

            ForEach(nearest) { item in
                if let coordinate = item.coordinate?.locationCoordinate {
                    Annotation(item.name, coordinate: coordinate) {
                        ProximityMapAnnotation(item: item)
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .flat))
        .frame(height: 154)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(alignment: .topLeading) {
            Text(listingTitle)
                .font(.caption2.bold())
                .lineLimit(1)
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, Theme.Spacing.xs)
                .background(.regularMaterial, in: Capsule())
                .padding(Theme.Spacing.sm)
        }
        .task(id: nearest.map(\.id).joined(separator: ":")) {
            position = .region(region)
        }
    }
}

private struct ProximityMapAnnotation: View {
    let item: ProximityNearestItem

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: item.category.systemImage)
                .font(.caption2.bold())
            Text(item.walkMinutes == 1 ? "1m" : "\(item.walkMinutes)m")
                .font(.caption2.monospacedDigit())
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .background(item.category.tintColor, in: Capsule())
        .overlay {
            Capsule().stroke(Color.white.opacity(0.5), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
    }
}

private struct SummaryNote: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
            Image(systemName: "text.quote")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.sm)
        .background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Color(nsColor: .separatorColor).opacity(0.18), lineWidth: 0.5)
        }
    }
}

private struct ProximityHighlightBadge: View {
    let item: ProximityNearestItem

    var body: some View {
        HStack(spacing: Theme.Spacing.xs) {
            Image(systemName: item.category.systemImage)
                .foregroundStyle(item.category.tintColor)
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(item.label)
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                Text("\(item.walkMinutes) min • \(item.name)")
                    .font(.caption)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(item.category.tintColor.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.sm)
                .strokeBorder(item.category.tintColor.opacity(0.16), lineWidth: 0.5)
        }
    }
}

private struct ProximityNearestCard: View {
    let item: ProximityNearestItem

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(spacing: Theme.Spacing.sm) {
                Image(systemName: item.category.systemImage)
                    .foregroundStyle(item.category.tintColor)
                Text(item.label)
                    .font(.caption.bold())
                    .lineLimit(1)
                Spacer(minLength: 0)
                if item.rank > 1 {
                    Text("#\(item.rank)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            Text("\(item.walkMinutes) min walk")
                .font(.body.bold())
            Text(item.name)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Text("\(item.distanceM)m")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Spacing.sm)
        .background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(item.category.tintColor.opacity(0.18), lineWidth: 1)
        }
    }
}

private struct CountChip: View {
    let item: ProximityCountItem

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: item.category.systemImage)
                .foregroundStyle(item.category.tintColor)
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text("\(item.count)")
                    .font(.caption.bold())
                Text(item.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.sm)
                .strokeBorder(Color(nsColor: .separatorColor).opacity(0.18), lineWidth: 0.5)
        }
    }
}
