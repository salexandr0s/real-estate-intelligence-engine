import SwiftUI

/// POI layer toggle button with popover picker for map overlay categories.
struct POILayerMenu: View {
    @Binding var activePOICategories: Set<POICategory>
    @Binding var showPOIPicker: Bool
    let onCategoryChanged: () -> Void

    private var showPOIs: Bool { !activePOICategories.isEmpty }

    var body: some View {
        Button("Points of Interest", systemImage: showPOIs ? "signpost.right.and.left.fill" : "signpost.right.and.left") {
            showPOIPicker.toggle()
        }
        .labelStyle(.iconOnly)
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(showPOIs ? .blue : .primary)
        .frame(width: 36, height: 36)
        .contentShape(Rectangle())
        .buttonStyle(.plain)
        .help("Points of Interest")
        .popover(isPresented: $showPOIPicker, arrowEdge: .leading) {
            POIPickerContent(
                activePOICategories: $activePOICategories,
                onCategoryChanged: onCategoryChanged
            )
        }
    }
}

/// Popover content for selecting POI categories.
private struct POIPickerContent: View {
    @Binding var activePOICategories: Set<POICategory>
    let onCategoryChanged: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(POICategoryGroup.allCases.enumerated()), id: \.element) { index, group in
                if index > 0 {
                    Divider().padding(.vertical, 2)
                }
                POIGroupSection(
                    group: group,
                    activePOICategories: $activePOICategories,
                    onCategoryChanged: onCategoryChanged
                )
            }

            Divider().padding(.vertical, 2)

            Button(activePOICategories.count == POICategory.allCases.count ? "Clear All" : "Select All") {
                if activePOICategories.count == POICategory.allCases.count {
                    activePOICategories.removeAll()
                } else {
                    activePOICategories = Set(POICategory.allCases)
                }
                onCategoryChanged()
            }
            .font(.caption)
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(12)
        .fixedSize()
    }
}

/// A group header and its category toggles.
private struct POIGroupSection: View {
    let group: POICategoryGroup
    @Binding var activePOICategories: Set<POICategory>
    let onCategoryChanged: () -> Void

    var body: some View {
        Text(group.displayName)
            .font(.caption2.bold())
            .foregroundStyle(.tertiary)
            .textCase(.uppercase)

        ForEach(group.categories, id: \.self) { category in
            POICategoryButton(
                category: category,
                isActive: activePOICategories.contains(category)
            ) {
                if activePOICategories.contains(category) {
                    activePOICategories.remove(category)
                } else {
                    activePOICategories.insert(category)
                }
                onCategoryChanged()
            }
        }
    }
}

/// A single toggleable POI category row.
private struct POICategoryButton: View {
    let category: POICategory
    let isActive: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack {
                Label(category.displayName, systemImage: category.systemImage)
                    .font(.caption)
                Spacer()
                if isActive {
                    Image(systemName: "checkmark")
                        .font(.caption)
                        .foregroundStyle(Color.accentColor)
                }
            }
        }
        .buttonStyle(.plain)
    }
}
