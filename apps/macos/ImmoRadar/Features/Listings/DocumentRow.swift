import SwiftUI

/// A single document row with status, link, and expandable facts.
struct DocumentRow: View {
    let doc: ListingDocument
    let isExpanded: Bool
    let isLoadingFacts: Bool
    let facts: [DocumentFact]?
    let onToggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack {
                Image(systemName: documentIcon(doc.documentType))
                    .foregroundStyle(.secondary)
                    .font(.caption)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text(doc.label ?? doc.documentType.capitalized)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .lineLimit(1)

                    HStack(spacing: Theme.Spacing.sm) {
                        StatusBadge(label: doc.status.capitalized, color: statusColor(doc.status))
                        if let pages = doc.pageCount {
                            Text("\(pages) pages")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Spacer()

                if let url = URL(string: doc.url) {
                    Link(destination: url) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.caption)
                            .accessibilityLabel("Open original document")
                    }
                    .help("Open original document")
                }

                Button(
                    isExpanded ? "Hide Facts" : "Show Facts",
                    systemImage: isExpanded ? "chevron.up" : "chevron.down"
                ) {
                    onToggle()
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
            }

            if isExpanded {
                DocumentFactsView(facts: facts, isLoading: isLoadingFacts)
            }
        }
        .padding(Theme.Spacing.sm)
        .background(Theme.cardBackground)
        .clipShape(.rect(cornerRadius: Theme.Radius.sm))
    }

    // MARK: - Helpers

    private func documentIcon(_ type: String) -> String {
        switch type.lowercased() {
        case "pdf", "expose": "doc.richtext"
        case "floor_plan", "floorplan": "square.grid.3x3"
        case "energy_certificate": "bolt.fill"
        case "image", "photo": "photo"
        default: "doc"
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status.lowercased() {
        case "extracted": .green
        case "downloaded": .blue
        case "pending": .orange
        case "failed": .red
        default: .secondary
        }
    }
}
