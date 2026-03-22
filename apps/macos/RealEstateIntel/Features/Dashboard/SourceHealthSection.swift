import SwiftUI

/// Source health overview card with internal scrolling.
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

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(sources, id: \.id) { source in
                        SourceHealthRow(source: source)
                        if source.id != sources.last?.id {
                            Divider()
                        }
                    }
                }
            }
            .scrollIndicators(.automatic)
        }
        .cardStyle()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
