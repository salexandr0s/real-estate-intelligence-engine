import XCTest
@testable import ImmoRadar

final class WorkerHoldsTests: XCTestCase {
    private let start = ContinuousClock.now

    private func at(_ seconds: Int) -> ContinuousClock.Instant {
        start + .seconds(seconds)
    }

    func testWakingWhileHotKeepsTheWorkersStopped() {
        var holds = WorkerHolds()
        holds.set(.heat, isActive: true, now: at(0))
        holds.set(.sleep, isActive: true, now: at(1))
        holds.set(.sleep, isActive: false, now: at(2))

        holds.finishWait(now: at(60))

        XCTAssertTrue(holds.isHolding)
        XCTAssertEqual(holds.explanation, WorkerHolds.Reason.heat.explanation)
    }

    func testWakeDoesNotShortenACoolingWait() {
        var holds = WorkerHolds()
        holds.set(.heat, isActive: true, now: at(0))
        holds.set(.heat, isActive: false, now: at(10))
        holds.set(.sleep, isActive: true, now: at(60))
        holds.set(.sleep, isActive: false, now: at(70))

        holds.finishWait(now: at(100))
        XCTAssertTrue(holds.isHolding)
        XCTAssertEqual(holds.explanation, WorkerHolds.Reason.heat.explanation)

        holds.finishWait(now: at(310))
        XCTAssertFalse(holds.isHolding)
        XCTAssertNil(holds.explanation)
    }

    func testRepeatedClearNotificationsDoNotRestartTheWait() {
        var holds = WorkerHolds()
        holds.set(.heat, isActive: true, now: at(0))
        holds.set(.heat, isActive: false, now: at(10))
        holds.set(.heat, isActive: false, now: at(200))

        holds.finishWait(now: at(310))

        XCTAssertFalse(holds.isHolding)
    }

    func testHoldReturningDuringTheWaitNeedsAFullWait() {
        var holds = WorkerHolds()
        holds.set(.lowPower, isActive: true, now: at(0))
        holds.set(.lowPower, isActive: false, now: at(10))
        holds.set(.lowPower, isActive: true, now: at(100))

        holds.finishWait(now: at(310))
        XCTAssertTrue(holds.isHolding)

        holds.set(.lowPower, isActive: false, now: at(320))
        holds.finishWait(now: at(400))
        XCTAssertTrue(holds.isHolding)

        holds.finishWait(now: at(620))
        XCTAssertFalse(holds.isHolding)
    }
}
