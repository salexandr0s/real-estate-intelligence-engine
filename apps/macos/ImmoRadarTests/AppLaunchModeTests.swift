import XCTest
@testable import ImmoRadar

final class AppLaunchModeTests: XCTestCase {
    func testResolvePrefersXCTestEnvironment() {
        let environment = [
            "XCTestConfigurationFilePath": "/tmp/test.xctestconfiguration",
            "XCODE_RUNNING_FOR_PREVIEWS": "1",
        ]

        XCTAssertEqual(AppLaunchMode.resolve(environment: environment), .test)
    }

    func testResolveRecognizesPreviewEnvironment() {
        XCTAssertEqual(
            AppLaunchMode.resolve(environment: ["XCODE_RUNNING_FOR_PREVIEWS": "1"]),
            .preview
        )
    }

    @MainActor
    func testTestLaunchSkipsInitialSideEffectsAndBackgroundRefresh() async {
        let appState = AppState(launchMode: .test)

        await appState.performInitialLaunchIfNeeded()

        XCTAssertEqual(appState.bundledLaunchExperienceState, .ready)
        XCTAssertFalse(appState.hasActiveBackgroundRefreshTasks)
    }

    @MainActor
    func testTestLaunchDisablesAutomaticFeatureLoads() {
        let appState = AppState(launchMode: .test)

        XCTAssertFalse(appState.allowsAutomaticFeatureLoads)
    }
}
