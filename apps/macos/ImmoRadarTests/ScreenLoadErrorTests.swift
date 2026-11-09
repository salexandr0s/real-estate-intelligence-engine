import XCTest
@testable import ImmoRadar

@MainActor
final class ScreenLoadErrorTests: XCTestCase {
    /// The global banner shows a connection problem only after the next connection check, so a
    /// screen shows its own load error, a connection error included, until the banner is up.
    func testScreenShowsItsLoadErrorUntilTheGlobalBannerIsUp() async {
        let appState = AppState(launchMode: .test)
        await appState.performInitialLaunchIfNeeded()
        let connectionError = AppErrorPresentation.apiConnectionMessage

        XCTAssertEqual(appState.screenLoadError(connectionError), connectionError)
        XCTAssertNil(appState.screenLoadError(""))

        appState.connectionState.connectionIssue = connectionError
        XCTAssertNil(appState.screenLoadError(connectionError))
        XCTAssertNil(appState.screenLoadError("The server returned an error."))
    }
}
