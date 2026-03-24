import SwiftUI

/// Chat input bar styled as a floating rounded card — ChatGPT-style.
struct CopilotInputBar: View {
    @Binding var text: String
    let isStreaming: Bool
    let onSend: () -> Void
    let onStop: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: Theme.Spacing.md) {
            TextField("Ask anything", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.body)
                .lineLimit(1...5)
                .focused($isFocused)
                .onSubmit {
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        onSend()
                    }
                }

            actionButton
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .adaptiveMaterial(.thickMaterial, in: RoundedRectangle(cornerRadius: Theme.Radius.xl))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.xl)
                .strokeBorder(Color(nsColor: .separatorColor).opacity(0.6), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
        .onAppear { isFocused = true }
    }

    @ViewBuilder
    private var actionButton: some View {
        if isStreaming {
            Button("Stop generating", systemImage: "stop.circle.fill", action: onStop)
                .labelStyle(.iconOnly)
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(.red)
                .buttonStyle(.plain)
                .help("Stop generating")
        } else {
            Button("Send message", systemImage: "arrow.up.circle.fill", action: onSend)
                .labelStyle(.iconOnly)
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(
                    text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? Color.secondary.opacity(0.4) : Color.accentColor
                )
                .buttonStyle(.plain)
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .help("Send message (Return)")
        }
    }
}
