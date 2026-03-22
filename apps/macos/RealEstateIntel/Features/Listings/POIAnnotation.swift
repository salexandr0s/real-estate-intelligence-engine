import AppKit
import SwiftUI

/// Small map annotation for POIs, differentiated by category color and icon.
struct POIAnnotation: View {
    let poi: POI

    var body: some View {
        Image(systemName: poi.category.systemImage)
            .font(.system(size: 8))
            .foregroundStyle(.white)
            .frame(width: 16, height: 16)
            .background(poi.category.tintColor, in: Circle())
            .overlay(Circle().stroke(.white, lineWidth: 0.5))
    }
}

/// Map annotation for Wien development projects with hover popover.
struct DevelopmentAnnotation: View {
    let development: WienDevelopment
    @State private var isHovered = false

    var body: some View {
        VStack(spacing: 2) {
            if isHovered {
                DevelopmentPopover(development: development)
                    .transition(.opacity.combined(with: .scale(scale: 0.95, anchor: .bottom)))
                    .zIndex(100)
            }

            marker
        }
        .onHover { isHovered = $0 }
        .animation(.easeInOut(duration: 0.15), value: isHovered)
    }

    private var marker: some View {
        Image(systemName: "building.2.fill")
            .font(.system(size: 8))
            .foregroundStyle(.white)
            .frame(width: 16, height: 16)
            .background(development.statusColor, in: RoundedRectangle(cornerRadius: 3))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(.white, lineWidth: 0.5))
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
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 4)

                Text(development.statusDisplay)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(development.statusColor, in: Capsule())
            }

            // Category
            if let category = development.category {
                Text(category)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            // Duration
            if let duration = development.duration {
                HStack(spacing: 4) {
                    Image(systemName: "calendar")
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                    Text(duration)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }

            // Description
            if let desc = development.plainDescription {
                Text(desc)
                    .font(.system(size: 10))
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
                                .font(.system(size: 10))
                            Text("Open")
                                .font(.system(size: 10, weight: .medium))
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
