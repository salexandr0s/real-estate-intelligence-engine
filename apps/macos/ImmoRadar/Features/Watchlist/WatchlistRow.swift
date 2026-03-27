import AppKit
import SwiftUI

/// A single row in the watchlist showing listing info, shortlist notes, and quick actions.
struct WatchlistRow: View {
    let item: SavedListingItem
    let isSavingNotes: Bool
    let onSaveNotes: (String?) -> Void
    let onUnsave: () -> Void

    @State private var isHovered = false
    @State private var isEditingNotes = false
    @State private var notesDraft = ""

    private var trimmedNotesDraft: String {
        notesDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                if let score = item.listing.currentScore {
                    ScoreIndicator(score: score)
                }

                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                        Text(item.listing.title)
                            .font(.body)
                            .adaptiveFontWeight(.medium)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        if let price = item.listing.listPriceEur {
                            Text(PriceFormatter.format(eurDouble: price))
                                .font(.caption.monospacedDigit())
                                .adaptiveFontWeight(.semibold)
                                .foregroundStyle(.primary)
                        }
                    }

                    HStack(spacing: Theme.Spacing.sm) {
                        if let district = item.listing.districtName {
                            Label(district, systemImage: "mappin")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        if let area = item.listing.livingAreaSqm {
                            Text(PriceFormatter.formatArea(area))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }

                        if let rooms = item.listing.rooms {
                            Text("\(PriceFormatter.formatRooms(rooms)) rooms")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }

                        Text(item.listing.sourceCode.uppercased())
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.08), in: Capsule())
                    }
                }

                VStack(alignment: .trailing, spacing: Theme.Spacing.xs) {
                    Text("Saved \(PriceFormatter.relativeDate(item.parsedSavedAt))")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    HStack(spacing: Theme.Spacing.xs) {
                        Button(isEditingNotes ? "Cancel note editing" : "Edit note", systemImage: "square.and.pencil") {
                            withAnimation(.easeInOut(duration: 0.16)) {
                                isEditingNotes.toggle()
                                notesDraft = item.notes ?? ""
                            }
                        }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .help(isEditingNotes ? "Cancel note editing" : "Edit note")

                        Button("Open in Browser", systemImage: "safari") {
                            if let browserURL = URL(string: item.listing.canonicalUrl) {
                                NSWorkspace.shared.open(browserURL)
                            }
                        }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .help("Open in Browser")

                        Button("Remove from watchlist", systemImage: "bookmark.slash", action: onUnsave)
                            .labelStyle(.iconOnly)
                            .foregroundStyle(.red)
                            .buttonStyle(.borderless)
                            .help("Remove from watchlist")
                    }
                    .opacity(isHovered || isEditingNotes ? 1 : 0.7)
                }
            }

            notesSection
        }
        .padding(.vertical, Theme.Spacing.sm)
        .onAppear {
            notesDraft = item.notes ?? ""
        }
        .onChange(of: item.notes) { _, newValue in
            if !isEditingNotes {
                notesDraft = newValue ?? ""
            }
        }
        .background(isHovered ? Color(nsColor: .separatorColor).opacity(0.05) : .clear)
        .onHover { isHovered = $0 }
        .contextMenu {
            if let browserURL = URL(string: item.listing.canonicalUrl) {
                Button {
                    NSWorkspace.shared.open(browserURL)
                } label: {
                    Label("Open in Browser", systemImage: "safari")
                }
            }
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(item.listing.canonicalUrl, forType: .string)
            } label: {
                Label("Copy URL", systemImage: "doc.on.doc")
            }
            if let url = URL(string: item.listing.canonicalUrl) {
                ShareLink(item: url) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }
            Divider()
            Button {
                isEditingNotes = true
                notesDraft = item.notes ?? ""
            } label: {
                Label("Edit Note", systemImage: "square.and.pencil")
            }
            Button(role: .destructive, action: onUnsave) {
                Label("Remove from Watchlist", systemImage: "bookmark.slash")
            }
        }
    }

    @ViewBuilder
    private var notesSection: some View {
        if isEditingNotes {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Text("Investor note")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                TextField("Capture why this listing matters, what to verify, or what to compare next.", text: $notesDraft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...5)

                HStack(spacing: Theme.Spacing.sm) {
                    if isSavingNotes {
                        ProgressView()
                            .controlSize(.small)
                    }

                    Spacer()

                    if !trimmedNotesDraft.isEmpty || !(item.notes ?? "").isEmpty {
                        Button("Clear") {
                            notesDraft = ""
                        }
                        .buttonStyle(.borderless)
                    }

                    Button("Cancel") {
                        isEditingNotes = false
                        notesDraft = item.notes ?? ""
                    }
                    .buttonStyle(.borderless)

                    Button("Save Note") {
                        onSaveNotes(trimmedNotesDraft.isEmpty ? nil : trimmedNotesDraft)
                        isEditingNotes = false
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSavingNotes)
                }
            }
            .padding(.leading, item.listing.currentScore == nil ? 0 : 56)
        } else if let notes = item.notes, !notes.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text("Investor note")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(3)
            }
            .padding(.leading, item.listing.currentScore == nil ? 0 : 56)
        } else {
            HStack(spacing: Theme.Spacing.xs) {
                Image(systemName: "note.text")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Button("Add investor note") {
                    isEditingNotes = true
                    notesDraft = item.notes ?? ""
                }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .padding(.leading, item.listing.currentScore == nil ? 0 : 56)
        }
    }
}
