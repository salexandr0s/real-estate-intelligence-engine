import SwiftUI

/// Sidebar navigation items.
enum NavigationItem: String, CaseIterable, Identifiable {
    case dashboard
    case listings
    case filters
    case alerts
    case sources
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .listings: "Listings"
        case .filters: "Filters"
        case .alerts: "Alerts"
        case .sources: "Sources"
        case .settings: "Settings"
        }
    }

    var icon: String {
        switch self {
        case .dashboard: "square.grid.2x2"
        case .listings: "building.2"
        case .filters: "line.3.horizontal.decrease.circle"
        case .alerts: "bell"
        case .sources: "antenna.radiowaves.left.and.right"
        case .settings: "gearshape"
        }
    }

    /// Keyboard shortcut number (Cmd+1 through Cmd+6).
    var shortcutKey: KeyEquivalent? {
        switch self {
        case .dashboard: "1"
        case .listings: "2"
        case .filters: "3"
        case .alerts: "4"
        case .sources: "5"
        case .settings: "6"
        }
    }
}
