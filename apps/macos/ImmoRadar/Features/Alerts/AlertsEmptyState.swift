import SwiftUI

struct AlertsEmptyState: View {
    let scope: AlertsScope
    let hasAnyAlerts: Bool
    let hasSearch: Bool
    var onClearSearch: (() -> Void)?
    var onSwitchToAll: (() -> Void)?
    var onOpenFilters: (() -> Void)?
    var onRefresh: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(description)
        } actions: {
            if hasSearch, let onClearSearch {
                Button("Clear Search", action: onClearSearch)
            }

            if scope != .all, let onSwitchToAll {
                Button("View All Alerts", action: onSwitchToAll)
            }

            if let onOpenFilters {
                Button("Review Filters", action: onOpenFilters)
            }

            if let onRefresh {
                Button("Refresh") {
                    onRefresh()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var title: String {
        if hasSearch {
            return "No Matching Alerts"
        }

        switch scope {
        case .unread:
            return hasAnyAlerts ? "Inbox Clear" : "No Alerts Yet"
        case .active:
            return hasAnyAlerts ? "No Active Alerts" : "No Alerts Yet"
        case .dismissed:
            return hasAnyAlerts ? "No Dismissed Alerts" : "No Alerts Yet"
        case .all:
            return "No Alerts Yet"
        }
    }

    private var systemImage: String {
        hasSearch ? "magnifyingglass" : "bell.slash"
    }

    private var description: String {
        if hasSearch {
            return "No alerts in this scope match your current search."
        }

        switch scope {
        case .unread:
            return hasAnyAlerts
                ? "You’ve cleared the unread inbox. Switch scope to review older alerts or adjust your filters."
                : "When listings match your filters, new alerts will appear here."
        case .active:
            return hasAnyAlerts
                ? "There are no active alerts to triage right now."
                : "When listings match your filters, alerts will appear here."
        case .dismissed:
            return hasAnyAlerts
                ? "Dismissed alerts will appear here once you archive them."
                : "There are no alerts in history yet."
        case .all:
            return "When listings match your filters, alerts will appear here."
        }
    }
}
