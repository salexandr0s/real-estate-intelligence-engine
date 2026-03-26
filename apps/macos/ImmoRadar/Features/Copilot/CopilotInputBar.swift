import SwiftUI

/// Workspace composer for Copilot prompts.
struct CopilotInputBar: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var text: String
    let isStreaming: Bool
    let onSend: () -> Void
    let onStop: () -> Void

    @FocusState private var isFocused: Bool

    private var trimmedText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var borderColor: Color {
        isFocused ? Color.accentColor.opacity(0.26) : Color(nsColor: .separatorColor).opacity(0.4)
    }

    private var shadowColor: Color {
        isFocused ? Color.accentColor.opacity(0.08) : .black.opacity(0.08)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            TextField("Ask anything", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.body)
                .lineLimit(1...8)
                .focused($isFocused)
                .onSubmit {
                    if !trimmedText.isEmpty {
                        onSend()
                    }
                }

            HStack(spacing: Theme.Spacing.sm) {
                Text("Saved locally. Rendered evidence stays with the session.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)

                Spacer()

                Text("Return to send")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, Theme.Spacing.sm)
                    .padding(.vertical, 4)
                    .background(Color.secondary.opacity(0.08), in: Capsule())

                actionButton
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(Theme.inputBarBackground, in: RoundedRectangle(cornerRadius: Theme.Copilot.composerRadius))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Copilot.composerRadius)
                .strokeBorder(borderColor, lineWidth: isFocused ? 1 : 0.5)
        }
        .shadow(color: shadowColor, radius: isFocused ? 22 : 18, y: 8)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: isFocused)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: trimmedText.isEmpty)
        .onAppear { isFocused = true }
    }

    @ViewBuilder
    private var actionButton: some View {
        if isStreaming {
            Button("Stop", systemImage: "stop.fill", action: onStop)
                .labelStyle(.iconOnly)
                .font(.body.bold())
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(.red, in: Circle())
                .buttonStyle(.plain)
                .help("Stop generating")
        } else {
            Button("Send", systemImage: "arrow.up", action: onSend)
                .labelStyle(.iconOnly)
                .font(.body.bold())
                .foregroundStyle(trimmedText.isEmpty ? Color.secondary : Color.white)
                .frame(width: 34, height: 34)
                .background(trimmedText.isEmpty ? Color.secondary.opacity(0.18) : .accentColor, in: Circle())
                .scaleEffect(trimmedText.isEmpty || reduceMotion ? 1 : 1.03)
                .buttonStyle(.plain)
                .disabled(trimmedText.isEmpty)
                .help("Send prompt (Return)")
        }
    }
}
