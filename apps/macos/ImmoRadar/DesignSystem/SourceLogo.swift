import SwiftUI

/// Displays the brand logo for a scraping source, mapped from its source code.
/// Falls back to a generic globe icon for unknown sources.
struct SourceLogo: View {
    let sourceCode: String
    var size: CGFloat = 16

    var body: some View {
        Image(imageName)
            .resizable()
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
    }

    private var imageName: String {
        switch sourceCode.lowercased() {
        case "willhaben":
            "source-willhaben"
        case "immoscout24", "immoscout":
            "source-immoscout24"
        case "wohnnet":
            "source-wohnnet"
        case "derstandard":
            "source-derstandard"
        case "findmyhome":
            "source-findmyhome"
        case "openimmo":
            "source-openimmo"
        case "remax":
            "source-remax"
        case "bazar", "immoworld", "immo-world":
            "source-generic" // no dedicated logo yet
        default:
            "source-generic"
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        ForEach(["willhaben", "immoscout24", "wohnnet", "derstandard", "findmyhome", "openimmo", "remax", "unknown"], id: \.self) { code in
            HStack(spacing: 8) {
                SourceLogo(sourceCode: code, size: 24)
                Text(code)
                    .font(.body)
            }
        }
    }
    .padding()
}
