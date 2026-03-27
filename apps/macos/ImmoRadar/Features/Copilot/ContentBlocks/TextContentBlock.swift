import SwiftUI

/// Renders markdown text with optional streaming cursor.
struct TextContentBlock: View {
    let text: String
    let isStreaming: Bool
    private let renderedText: AttributedString?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var cursorVisible = true

    init(text: String, isStreaming: Bool) {
        self.text = text
        self.isStreaming = isStreaming
        self.renderedText = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )
    }

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 0) {
            if let renderedText {
                Text(renderedText)
                    .textSelection(.enabled)
                    .lineSpacing(3)
            } else {
                Text(text)
                    .textSelection(.enabled)
                    .lineSpacing(3)
            }

            if isStreaming {
                Text("|")
                    .foregroundStyle(.secondary)
                    .opacity(reduceMotion ? 1 : (cursorVisible ? 1 : 0))
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                        value: cursorVisible
                    )
                    .onAppear {
                        if !reduceMotion { cursorVisible.toggle() }
                    }
            }
        }
    }
}
