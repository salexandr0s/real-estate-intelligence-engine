import SwiftUI

/// Source health overview card with per-source status rows.
struct SourceHealthSection: View {
    let sources: [Source]
    let healthyCount: Int
    let activeCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Label("Source Health", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.headline)
                Spacer()
                Text("\(healthyCount)/\(activeCount) healthy")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 0) {
                ForEach(sources, id: \.id) { source in
                    SourceHealthRow(source: source)
                    if source.id != sources.last?.id {
                        Divider()
                    }
                }
            }
        }
        .cardStyle()
        .frame(minWidth: 300, maxWidth: 400)
    }
}
