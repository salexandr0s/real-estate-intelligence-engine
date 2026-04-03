import XCTest
@testable import ImmoRadar

final class LocalRuntimeStartupPolicyTests: XCTestCase {
    @MainActor
    func testRepoRuntimeReuseRequiresHealthyAPIAndWorkers() {
        let reusable = LocalRuntimeService.canReuseManagedRuntime(
            usesBundledRuntime: false,
            apiHealthy: true,
            componentStatuses: [
                .api: true,
                .processing: true,
                .scraper: true,
            ]
        )

        XCTAssertTrue(reusable)
    }

    @MainActor
    func testRepoRuntimeReuseFailsWhenAWorkerIsMissing() {
        let reusable = LocalRuntimeService.canReuseManagedRuntime(
            usesBundledRuntime: false,
            apiHealthy: true,
            componentStatuses: [
                .api: true,
                .processing: true,
                .scraper: false,
            ]
        )

        XCTAssertFalse(reusable)
    }

    @MainActor
    func testBundledRuntimeReuseRequiresInfrastructureComponents() {
        let reusable = LocalRuntimeService.canReuseManagedRuntime(
            usesBundledRuntime: true,
            apiHealthy: true,
            componentStatuses: [
                .postgres: true,
                .redis: true,
                .api: true,
                .processing: true,
                .scraper: true,
            ]
        )

        XCTAssertTrue(reusable)
    }

    @MainActor
    func testRuntimeReuseFailsWhenAPIIsNotHealthy() {
        let reusable = LocalRuntimeService.canReuseManagedRuntime(
            usesBundledRuntime: true,
            apiHealthy: false,
            componentStatuses: [
                .postgres: true,
                .redis: true,
                .api: true,
                .processing: true,
                .scraper: true,
            ]
        )

        XCTAssertFalse(reusable)
    }
}
