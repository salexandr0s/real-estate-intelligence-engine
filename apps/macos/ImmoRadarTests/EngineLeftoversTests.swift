import XCTest
@testable import ImmoRadar

final class EngineLeftoversTests: XCTestCase {
    private let dataDirectory = "/home/postgres/data"

    private func live(_ executable: String) -> ProcessObservation {
        .live(ProcessIdentity(pid: 762, startSeconds: 1, startMicros: 0, executablePath: executable))
    }

    func testDeadPIDLeavesTheFileForPostgres() {
        XCTAssertEqual(
            EngineLeftovers.postmasterDecision(
                recorded: .exited,
                recordedCWD: nil,
                dataDirectory: dataDirectory,
                postgresHoldingData: false
            ),
            .leaveFile
        )
    }

    func testLiveUnrelatedPIDDeletesTheFile() {
        XCTAssertEqual(
            EngineLeftovers.postmasterDecision(
                recorded: live("/usr/libexec/corespotlightd"),
                recordedCWD: "/",
                dataDirectory: dataDirectory,
                postgresHoldingData: false
            ),
            .deleteFile
        )
    }

    func testLiveUnrelatedPIDKeepsTheFileWhileBackendsHoldTheData() {
        XCTAssertEqual(
            EngineLeftovers.postmasterDecision(
                recorded: live("/usr/libexec/corespotlightd"),
                recordedCWD: "/",
                dataDirectory: dataDirectory,
                postgresHoldingData: true
            ),
            .leaveFile
        )
    }

    func testLivePostgresInAFolderThatCantBeReadKeepsTheFile() {
        XCTAssertEqual(
            EngineLeftovers.postmasterDecision(
                recorded: live("/opt/homebrew/opt/postgresql@17/bin/postgres"),
                recordedCWD: nil,
                dataDirectory: dataDirectory,
                postgresHoldingData: false
            ),
            .leaveFile
        )
    }

    func testOwnPostgresHasToStopFirst() {
        XCTAssertEqual(
            EngineLeftovers.postmasterDecision(
                recorded: live("/opt/homebrew/opt/postgresql@17/bin/postgres"),
                recordedCWD: dataDirectory,
                dataDirectory: dataDirectory,
                postgresHoldingData: true
            ),
            .stopPostgres(762)
        )
    }
}
