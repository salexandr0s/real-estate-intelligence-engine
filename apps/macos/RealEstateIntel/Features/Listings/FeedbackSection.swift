import os
import SwiftUI

/// Investor feedback rating buttons for a listing detail view.
struct FeedbackSection: View {
    let listingId: Int
    @Environment(AppState.self) private var appState
    @State private var currentRating: FeedbackRating?
    @State private var notes: String = ""
    @State private var showNotes: Bool = false
    @State private var isSaving: Bool = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(spacing: Theme.Spacing.sm) {
                ForEach(FeedbackRating.allCases, id: \.rawValue) { rating in
                    Button {
                        Task { await toggleRating(rating) }
                    } label: {
                        VStack(spacing: Theme.Spacing.xxs) {
                            Image(systemName: currentRating == rating ? rating.filledIcon : rating.icon)
                                .font(.title3)
                                .foregroundStyle(currentRating == rating ? ratingColor(rating) : .secondary)

                            Text(rating.displayName)
                                .font(.caption2)
                                .foregroundStyle(currentRating == rating ? .primary : .tertiary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Theme.Spacing.xxs)
                        .background(
                            currentRating == rating
                                ? ratingColor(rating).opacity(0.1)
                                : Color.clear
                        )
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                    }
                    .buttonStyle(.plain)
                    .disabled(isSaving)
                }
            }

            if currentRating != nil {
                Button {
                    withAnimation(.easeInOut(duration: 0.16)) {
                        showNotes.toggle()
                    }
                } label: {
                    HStack(spacing: Theme.Spacing.xxs) {
                        Image(systemName: "note.text")
                            .font(.caption2)
                        Text(showNotes ? "Hide Notes" : "Add Notes")
                            .font(.caption2)
                    }
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)

                if showNotes {
                    TextField("Add notes...", text: $notes, axis: .vertical)
                        .font(.caption)
                        .lineLimit(3...5)
                        .textFieldStyle(.roundedBorder)

                    Button("Save Notes") {
                        Task { await saveNotes() }
                    }
                    .font(.caption)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(isSaving)
                }
            }
        }
        .task(id: listingId) {
            await loadFeedback()
        }
    }

    private func loadFeedback() async {
        do {
            if let fb = try await appState.apiClient.fetchFeedback(listingId: listingId) {
                currentRating = FeedbackRating(rawValue: fb.rating)
                notes = fb.notes ?? ""
                showNotes = !(fb.notes ?? "").isEmpty
            } else {
                currentRating = nil
                notes = ""
                showNotes = false
            }
        } catch {
            currentRating = nil
        }
    }

    private func toggleRating(_ rating: FeedbackRating) async {
        isSaving = true
        defer { isSaving = false }

        if currentRating == rating {
            do {
                try await appState.apiClient.deleteFeedback(listingId: listingId)
                currentRating = nil
                notes = ""
                showNotes = false
            } catch {
                errorMessage = error.localizedDescription
            }
        } else {
            do {
                _ = try await appState.apiClient.submitFeedback(
                    listingId: listingId,
                    rating: rating.rawValue,
                    notes: notes.isEmpty ? nil : notes
                )
                currentRating = rating
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func saveNotes() async {
        guard let rating = currentRating else { return }
        isSaving = true
        defer { isSaving = false }

        do {
            _ = try await appState.apiClient.submitFeedback(
                listingId: listingId,
                rating: rating.rawValue,
                notes: notes.isEmpty ? nil : notes
            )
        } catch {
            Log.ui.error("Save notes failed: \(error, privacy: .public)")
        }
    }

    private func ratingColor(_ rating: FeedbackRating) -> Color {
        switch rating {
        case .interested: .green
        case .notInterested: .red
        case .bookmarked: .orange
        case .contacted: .blue
        }
    }
}
