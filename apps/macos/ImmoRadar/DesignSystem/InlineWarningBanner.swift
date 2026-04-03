import SwiftUI

struct InlineWarningBanner: View {
    struct Action: Identifiable {
        let id = UUID()
        let title: String
        let systemImage: String?
        let isProminent: Bool
        let handler: () -> Void

        init(
            _ title: String,
            systemImage: String? = nil,
            isProminent: Bool = false,
            handler: @escaping () -> Void
        ) {
            self.title = title
            self.systemImage = systemImage
            self.isProminent = isProminent
            self.handler = handler
        }
    }

    let title: String?
    let message: String
    var bannerActions: [Action] = []

    init(title: String? = nil, message: String, actions: [Action] = []) {
        self.title = title
        self.message = message
        self.bannerActions = actions
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            ZStack {
                Circle()
                    .fill(Color.scoreAverage.opacity(0.14))
                    .frame(width: 30, height: 30)

                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.scoreAverage)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                if let title {
                    Text(title)
                        .font(.callout.weight(.semibold))
                }

                Text(message)
                    .font(title == nil ? .callout : .caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: Theme.Spacing.md)

            if !bannerActions.isEmpty {
                HStack(spacing: Theme.Spacing.sm) {
                    ForEach(bannerActions) { action in
                        if action.isProminent {
                            bannerButton(for: action)
                                .buttonStyle(BorderedProminentButtonStyle())
                        } else {
                            bannerButton(for: action)
                                .buttonStyle(BorderedButtonStyle())
                        }
                    }
                }
            }
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.md)
        .background(
            Color.scoreAverage.opacity(0.08),
            in: RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .strokeBorder(Color.scoreAverage.opacity(0.16), lineWidth: 0.5)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func bannerButton(for action: Action) -> some View {
        Button(action: action.handler) {
            if let systemImage = action.systemImage {
                Label(action.title, systemImage: systemImage)
            } else {
                Text(action.title)
            }
        }
        .controlSize(.small)
    }
}
