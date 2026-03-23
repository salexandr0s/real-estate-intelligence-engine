import SwiftUI

/// Renders markdown text with optional streaming cursor.
struct TextContentBlock: View {
    let text: String
    let isStreaming: Bool

    @State private var cursorVisible = true

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 0) {
            if let attributed = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
                Text(attributed)
                    .textSelection(.enabled)
            } else {
                Text(text)
                    .textSelection(.enabled)
            }

            if isStreaming {
                Text("|")
                    .foregroundStyle(.secondary)
                    .opacity(cursorVisible ? 1 : 0)
                    .animation(
                        .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                        value: cursorVisible
                    )
                    .onAppear { cursorVisible.toggle() }
            }
        }
    }
}
