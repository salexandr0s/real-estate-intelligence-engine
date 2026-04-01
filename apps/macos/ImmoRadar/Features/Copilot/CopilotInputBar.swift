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
        isFocused ? Color.accentColor.opacity(0.18) : Color(nsColor: .separatorColor).opacity(0.28)
    }

    private var shadowColor: Color {
        isFocused ? Color.accentColor.opacity(0.04) : .black.opacity(0.03)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            TextField("Ask about listings, districts, price changes, or score drivers", text: $text, axis: .vertical)
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
                Text("Saved locally with this research session.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)

                Spacer()

                Text("Return to send")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

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
        .shadow(color: shadowColor, radius: isFocused ? 14 : 10, y: 4)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: isFocused)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: trimmedText.isEmpty)
        .task { isFocused = true }
    }

    @ViewBuilder
    private var actionButton: some View {
        if isStreaming {
            Button("Stop", systemImage: "stop.fill", action: onStop)
                .labelStyle(.iconOnly)
                .font(.body.bold())
                .foregroundStyle(.red)
                .frame(width: 34, height: 34)
                .background(Color.red.opacity(0.12), in: Circle())
                .overlay {
                    Circle()
                        .strokeBorder(Color.red.opacity(0.18), lineWidth: 0.5)
                }
                .buttonStyle(.plain)
                .help("Stop generating")
        } else {
            Button("Send", systemImage: "arrow.up", action: onSend)
                .labelStyle(.iconOnly)
                .font(.body.bold())
                .foregroundStyle(trimmedText.isEmpty ? Color.secondary : Color.accentColor)
                .frame(width: 34, height: 34)
                .background(
                    trimmedText.isEmpty ? Color.secondary.opacity(0.12) : Color.accentColor.opacity(0.12),
                    in: Circle()
                )
                .overlay {
                    Circle()
                        .strokeBorder(
                            trimmedText.isEmpty ? Color.secondary.opacity(0.14) : Color.accentColor.opacity(0.18),
                            lineWidth: 0.5
                        )
                }
                .scaleEffect(trimmedText.isEmpty || reduceMotion ? 1 : 1.03)
                .buttonStyle(.plain)
                .disabled(trimmedText.isEmpty)
                .help("Send prompt (Return)")
        }
    }
}
