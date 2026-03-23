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
                        DocumentRow(
                            doc: doc,
                            isExpanded: expandedDocId == doc.id,
                            isLoadingFacts: loadingFacts.contains(doc.id),
                            facts: factsCache[doc.id],
                            onToggle: { toggleFacts(for: doc.id) }
                        )
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
}
