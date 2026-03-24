import SwiftUI

/// Small map annotation for POIs, differentiated by category color and icon.
struct POIAnnotation: View {
    let poi: POI

    var body: some View {
        Image(systemName: poi.category.systemImage)
            .font(.system(size: 8)) // Fixed size: map marker icon
            .foregroundStyle(.white)
            .frame(width: 16, height: 16)
            .background(poi.category.tintColor, in: Circle())
            .overlay { Circle().stroke(.white, lineWidth: 0.5) }
    }
}

/// Hover popover showing development project details.
struct DevelopmentPopover: View {
    let development: WienDevelopment

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Header: name + status
            HStack(alignment: .top, spacing: 8) {
                Text(development.name)
                    .font(.caption.bold())
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 4)

                Text(development.statusDisplay)
                    .font(.caption2)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(development.statusColor, in: Capsule())
            }

            // Category
            if let category = development.category {
                Text(category)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            // Duration
            if let duration = development.duration {
                HStack(spacing: 4) {
                    Image(systemName: "calendar")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(duration)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            // Description
            if let desc = development.plainDescription {
                Text(desc)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
            }

            // Link
            if let urlString = development.url, let url = URL(string: urlString) {
                HStack {
                    Spacer()
                    Button {
                        NSWorkspace.shared.open(url)
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "arrow.up.right.square")
                                .font(.caption2)
                            Text("Open")
                                .font(.caption2)
                        }
                        .foregroundStyle(.blue)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(10)
        .frame(width: 280)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
    }
}
