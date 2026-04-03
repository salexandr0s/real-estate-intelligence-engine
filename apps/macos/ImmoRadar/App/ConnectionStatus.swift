import SwiftUI

enum ConnectionStatus: Equatable {
    case connected
    case connecting
    case disconnected
    case error(String)

    var displayName: String {
        switch self {
        case .connected: "Connected"
        case .connecting: "Connecting..."
        case .disconnected: "Disconnected"
        case .error: "Connection issue"
        }
    }

    var iconName: String {
        switch self {
        case .connected: "circle.fill"
        case .connecting: "arrow.triangle.2.circlepath"
        case .disconnected: "circle"
        case .error: "exclamationmark.circle.fill"
        }
    }

    var color: Color {
        switch self {
        case .connected: .green
        case .connecting: .orange
        case .disconnected: .secondary
        case .error: .red
        }
    }

    var message: String? {
        guard case .error(let message) = self else { return nil }
        return message
    }
}
