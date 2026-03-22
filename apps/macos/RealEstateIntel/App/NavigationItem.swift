import SwiftUI

/// Sidebar navigation items.
enum NavigationItem: String, CaseIterable, Identifiable {
    case dashboard
    case listings
    case filters
    case alerts
    case watchlist
    case sources
    case analytics
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .listings: "Listings"
        case .filters: "Filters"
        case .alerts: "Alerts"
        case .watchlist: "Watchlist"
        case .sources: "Sources"
        case .analytics: "Analytics"
        case .settings: "Settings"
        }
    }

    var icon: String {
        switch self {
        case .dashboard: "square.grid.2x2"
        case .listings: "building.2"
        case .filters: "line.3.horizontal.decrease.circle"
        case .alerts: "bell"
        case .watchlist: "bookmark"
        case .sources: "antenna.radiowaves.left.and.right"
        case .analytics: "chart.bar.xaxis"
        case .settings: "gearshape"
        }
    }

    /// Keyboard shortcut number (Cmd+1 through Cmd+7).
    var shortcutKey: KeyEquivalent? {
        switch self {
        case .dashboard: "1"
        case .listings: "2"
        case .filters: "3"
        case .alerts: "4"
        case .watchlist: "5"
        case .sources: "6"
        case .analytics: "7"
        case .settings: "8"
        }
    }
}
