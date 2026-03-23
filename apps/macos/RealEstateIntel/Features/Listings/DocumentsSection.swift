import SwiftUI

/// Documents section showing attached documents and their extracted facts.
struct DocumentsSection: View {
    let documents: [ListingDocument]
    let isLoading: Bool
    let onLoadFacts: (Int) async -> [DocumentFact]

    @State private var isExpanded = false
    @State private var expandedDocId: Int?
    @State private var factsCache: [Int: [DocumentFact]] = [:]
    @State private var loadingFacts: Set<Int> = []

    var body: some View {
        if isLoading {
            ProgressView("Loading documents…")
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, Theme.Spacing.md)
        } else if !documents.isEmpty {
            DisclosureGroup(isExpanded: $isExpanded) {
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    ForEach(documents) { doc in
                        documentRow(doc)
                    }
                }
                .padding(.top, Theme.Spacing.sm)
            } label: {
                HStack(spacing: Theme.Spacing.sm) {
                    Text("Documents")
                        .font(.headline)
                    Text("\(documents.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, Theme.Spacing.xs)
                        .padding(.vertical, Theme.Spacing.xxs)
                        .background(.secondary.opacity(0.12))
                        .clipShape(Capsule())
                }
            }
        }
    }

    @ViewBuilder
    private func documentRow(_ doc: ListingDocument) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack {
                Image(systemName: documentIcon(doc.documentType))
                    .foregroundStyle(.secondary)
                    .font(.caption)

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
                    }
                    .help("Open original document")
                }

                Button {
                    toggleFacts(for: doc.id)
                } label: {
                    Image(systemName: expandedDocId == doc.id ? "chevron.up" : "chevron.down")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
            }

            if expandedDocId == doc.id {
                factsView(for: doc.id)
            }
        }
        .padding(Theme.Spacing.sm)
        .background(Theme.cardBackground)
        .clipShape(.rect(cornerRadius: Theme.Radius.sm))
    }

    @ViewBuilder
    private func factsView(for docId: Int) -> some View {
        if loadingFacts.contains(docId) {
            ProgressView()
                .controlSize(.small)
                .padding(.vertical, Theme.Spacing.xs)
        } else if let facts = factsCache[docId] {
            if facts.isEmpty {
                Text("No facts extracted")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, Theme.Spacing.xs)
            } else {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    ForEach(facts) { fact in
                        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                                Text(fact.factType.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(fact.factValue)
                                    .font(.caption)
                            }
                            Spacer()
                            StatusBadge(
                                label: fact.confidence.capitalized,
                                color: confidenceColor(fact.confidence)
                            )
                        }
                    }
                }
                .padding(.top, Theme.Spacing.xs)
            }
        }
    }

    private func toggleFacts(for docId: Int) {
        if expandedDocId == docId {
            expandedDocId = nil
        } else {
            expandedDocId = docId
            if factsCache[docId] == nil {
                loadingFacts.insert(docId)
                Task {
                    let facts = await onLoadFacts(docId)
                    factsCache[docId] = facts
                    loadingFacts.remove(docId)
                }
            }
        }
    }

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

    private func confidenceColor(_ level: String) -> Color {
        switch level.lowercased() {
        case "high": .green
        case "medium": .orange
        case "low": .red
        default: .secondary
        }
    }
}
