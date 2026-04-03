import Foundation

enum AppLaunchMode: Equatable {
    case production
    case preview
    case test

    static var current: Self {
        resolve(environment: ProcessInfo.processInfo.environment)
    }

    static func resolve(environment: [String: String]) -> Self {
        if environment["XCTestConfigurationFilePath"] != nil {
            return .test
        }

        if environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1" {
            return .preview
        }

        return .production
    }

    var allowsInitialLaunchSideEffects: Bool {
        self == .production
    }

    var allowsBackgroundRefreshTasks: Bool {
        self == .production
    }

    var shouldRequestNotificationPermission: Bool {
        self == .production
    }
}
