import SwiftUI

/// Workspace composer for Copilot prompts.
struct CopilotInputBar: View {
    @Binding var text: String
    let isStreaming: Bool
    let onSend: () -> Void
    let onStop: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            TextField("Search listings, compare markets, or explain a score change", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.body)
                .lineLimit(2...6)
                .focused($isFocused)
                .onSubmit {
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        onSend()
                    }
                }

            HStack {
                Text("Saved locally. Rendered evidence stays with the session.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)

                Spacer()

                actionButton
            }
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.md)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(Color(nsColor: .separatorColor).opacity(0.55), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.05), radius: 3, y: 1)
        .onAppear { isFocused = true }
    }

    @ViewBuilder
    private var actionButton: some View {
        if isStreaming {
            Button("Stop", systemImage: "stop.circle.fill", action: onStop)
                .buttonStyle(.borderless)
                .foregroundStyle(.red)
                .help("Stop generating")
        } else {
            Button("Analyze", systemImage: "arrow.up.circle.fill", action: onSend)
                .buttonStyle(.borderless)
                .foregroundStyle(
                    text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? Color.secondary.opacity(0.4) : Color.accentColor
                )
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .help("Send prompt (Return)")
        }
    }
}
