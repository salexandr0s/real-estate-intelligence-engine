import SwiftUI

/// A single cell in the proximity grid showing icon, text, and optional detail.
struct ProximityCell: View {
    let icon: String
    let color: Color
    let text: String
    var detail: String? = nil

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
            Image(systemName: icon)
                .font(.caption2)
                .foregroundStyle(color)
                .frame(width: 14)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 0) {
                Text(text)
                    .font(.caption)
                if let detail {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
