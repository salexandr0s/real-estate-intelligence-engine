import SwiftUI

struct AlertsEmptyState: View {
    let scope: AlertsScope
    let hasSearch: Bool
    /// True while the list shows one saved filter's alerts.
    let hasFilterSelection: Bool
    var onClearSearch: (() -> Void)?
    var onSwitchToAll: (() -> Void)?
    var onShowAllFilters: (() -> Void)?
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

            if hasFilterSelection, let onShowAllFilters {
                Button("Show All Filters", action: onShowAllFilters)
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

    // The list holds one status from the server, so an empty list says nothing about the others.

    private var title: String {
        if hasSearch {
            return "No Matching Alerts"
        }

        switch scope {
        case .unread: return "Inbox Clear"
        case .active: return "No Active Alerts"
        case .dismissed: return "No Dismissed Alerts"
        case .failed: return "No Failed Alerts"
        case .suppressed: return "No Suppressed Alerts"
        case .all: return "No Alerts Yet"
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
            return "No unread alerts. New matches for your filters appear here."
        case .active:
            return "There are no active alerts to triage right now."
        case .dismissed:
            return "Dismissed alerts will appear here once you archive them."
        case .failed:
            return "Alerts the server couldn’t send appear here."
        case .suppressed:
            return "Suppressed alerts appear here."
        case .all:
            return "When listings match your filters, alerts will appear here."
        }
    }
}
