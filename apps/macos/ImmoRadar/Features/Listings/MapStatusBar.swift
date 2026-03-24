import SwiftUI

/// Status bar at the bottom of the map showing listing counts and selection state.
struct MapStatusBar: View {
    let filteredCount: Int
    let mappableCount: Int
    let hasSelectionRegion: Bool
    let onClearSelection: () -> Void

    var body: some View {
        HStack {
            Text("\(mappableCount) of \(filteredCount) listings on map")
                .font(.caption)
                .foregroundStyle(.secondary)

            if mappableCount < filteredCount {
                Text("(\(filteredCount - mappableCount) without coordinates)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            if hasSelectionRegion {
                HStack(spacing: Theme.Spacing.xs) {
                    Image(systemName: "selection.pin.in.out")
                        .foregroundStyle(Color.accentColor)
                    Text("Area selected")
                        .font(.caption)
                        .foregroundStyle(Color.accentColor)
                    Button("Clear Selection", systemImage: "xmark.circle.fill", action: onClearSelection)
                        .labelStyle(.iconOnly)
                        .foregroundStyle(.secondary)
                        .buttonStyle(.borderless)
                        .controlSize(.mini)
                }
            }
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.xs)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}
