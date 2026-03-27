import SwiftUI

struct OutreachWorkflowPresentation {
    let title: String
    let icon: String
    let tint: Color
    let background: Color
    let border: Color

    static func make(for state: String) -> OutreachWorkflowPresentation {
        switch state {
        case "draft":
            return .init(title: "Draft", icon: "square.and.pencil", tint: .secondary, background: Color.secondary.opacity(0.08), border: Color.secondary.opacity(0.14))
        case "queued_send":
            return .init(title: "Queued to Send", icon: "paperplane.circle", tint: .accentColor, background: Color.accentColor.opacity(0.10), border: Color.accentColor.opacity(0.16))
        case "sent_waiting_reply":
            return .init(title: "Awaiting Reply", icon: "clock.arrow.circlepath", tint: .scoreAverage, background: Color.scoreAverage.opacity(0.12), border: Color.scoreAverage.opacity(0.18))
        case "reply_received":
            return .init(title: "Reply Received", icon: "bubble.left.and.bubble.right.fill", tint: .scoreGood, background: Color.scoreGood.opacity(0.12), border: Color.scoreGood.opacity(0.18))
        case "followup_due":
            return .init(title: "Follow-up Due", icon: "calendar.badge.clock", tint: .scorePoor, background: Color.scorePoor.opacity(0.10), border: Color.scorePoor.opacity(0.16))
        case "followup_sent":
            return .init(title: "Follow-up Sent", icon: "paperplane.fill", tint: .scoreExcellent, background: Color.scoreExcellent.opacity(0.10), border: Color.scoreExcellent.opacity(0.16))
        case "paused":
            return .init(title: "Paused", icon: "pause.circle", tint: .secondary, background: Color.secondary.opacity(0.08), border: Color.secondary.opacity(0.14))
        case "closed":
            return .init(title: "Closed", icon: "checkmark.circle", tint: .secondary, background: Color.secondary.opacity(0.08), border: Color.secondary.opacity(0.14))
        case "failed":
            return .init(title: "Needs Retry", icon: "exclamationmark.triangle.fill", tint: .scorePoor, background: Color.scorePoor.opacity(0.10), border: Color.scorePoor.opacity(0.16))
        default:
            return .init(title: state.replacingOccurrences(of: "_", with: " ").capitalized, icon: "circle", tint: .secondary, background: Color.secondary.opacity(0.08), border: Color.secondary.opacity(0.14))
        }
    }
}

struct MailboxStatusPresentation {
    let title: String
    let icon: String
    let tint: Color
    let background: Color

    static func make(for status: String) -> MailboxStatusPresentation {
        switch status {
        case "healthy":
            return .init(title: "Healthy", icon: "checkmark.circle.fill", tint: .scoreGood, background: Color.scoreGood.opacity(0.12))
        case "syncing":
            return .init(title: "Syncing", icon: "arrow.triangle.2.circlepath", tint: .accentColor, background: Color.accentColor.opacity(0.12))
        case "degraded":
            return .init(title: "Degraded", icon: "exclamationmark.circle.fill", tint: .scoreAverage, background: Color.scoreAverage.opacity(0.12))
        case "failed":
            return .init(title: "Failed", icon: "xmark.octagon.fill", tint: .scorePoor, background: Color.scorePoor.opacity(0.12))
        case "disabled":
            return .init(title: "Disabled", icon: "slash.circle.fill", tint: .secondary, background: Color.secondary.opacity(0.10))
        case "idle":
            return .init(title: "Idle", icon: "moon.zzz.fill", tint: .secondary, background: Color.secondary.opacity(0.10))
        default:
            return .init(title: status.capitalized, icon: "questionmark.circle", tint: .secondary, background: Color.secondary.opacity(0.10))
        }
    }
}

struct OutreachDeliveryPresentation {
    let title: String
    let tint: Color

    static func make(for status: String) -> OutreachDeliveryPresentation {
        switch status {
        case "sent", "received":
            return .init(title: status.capitalized, tint: .scoreGood)
        case "queued":
            return .init(title: "Queued", tint: .accentColor)
        case "failed", "suppressed":
            return .init(title: status.capitalized, tint: .scorePoor)
        case "draft":
            return .init(title: "Draft", tint: .secondary)
        default:
            return .init(title: status.capitalized, tint: .secondary)
        }
    }
}

struct OutreachWorkflowBadge: View {
    let state: String

    var body: some View {
        let presentation = OutreachWorkflowPresentation.make(for: state)

        Label(presentation.title, systemImage: presentation.icon)
            .font(.caption.weight(.medium))
            .foregroundStyle(presentation.tint)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, 6)
            .background(presentation.background, in: Capsule())
            .overlay {
                Capsule()
                    .strokeBorder(presentation.border, lineWidth: 0.5)
            }
    }
}

struct MailboxStatusBadge: View {
    let status: String

    var body: some View {
        let presentation = MailboxStatusPresentation.make(for: status)

        Label(presentation.title, systemImage: presentation.icon)
            .font(.caption.weight(.medium))
            .foregroundStyle(presentation.tint)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, 6)
            .background(presentation.background, in: Capsule())
    }
}
