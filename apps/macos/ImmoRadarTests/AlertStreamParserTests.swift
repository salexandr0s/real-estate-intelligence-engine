import Foundation
import XCTest
@testable import ImmoRadar

final class AlertStreamParserTests: XCTestCase {
    /// `URLSession.AsyncBytes.lines` drops blank lines, which end SSE events. The parser must
    /// dispatch on the blank line itself and skip the keepalive comment.
    func testBlankLineEndsEventAndCommentsAreSkipped() {
        var parser = ServerSentEventParser()
        let events = parser.feed(": keepalive\n\nevent: connected\ndata: {\"timestamp\":\"t\"}\n\n".utf8)

        XCTAssertEqual(events, [ServerSentEvent(type: "connected", data: "{\"timestamp\":\"t\"}")])
    }

    func testDataLinesJoinWithNewlines() {
        var parser = ServerSentEventParser()
        let events = parser.feed("data: first\ndata:second\ndata\n\n".utf8)

        XCTAssertEqual(events, [ServerSentEvent(type: "message", data: "first\nsecond\n")])
    }

    /// Reads split events at arbitrary bytes, including between the CR and LF of a CRLF.
    func testEventSplitAcrossReadsWithCRLF() {
        var parser = ServerSentEventParser()

        XCTAssertEqual(parser.feed("event: al".utf8), [])
        XCTAssertEqual(parser.feed("ert\r\ndata: {\"id\":".utf8), [])
        XCTAssertEqual(parser.feed("7}\r".utf8), [])
        XCTAssertEqual(parser.feed("\n\r".utf8), [ServerSentEvent(type: "alert", data: "{\"id\":7}")])
        XCTAssertEqual(parser.feed("\ndata: next\n\n".utf8), [ServerSentEvent(type: "message", data: "next")])
    }

    /// The stream sends the GET /v1/alerts DTO, with server statuses and types the app may not know.
    func testAlertEventDecodesStreamDTO() throws {
        let payload = """
        {"id":42,"userFilterId":5,"listingId":300,"alertType":"brand_new_type","channel":"in_app",\
        "status":"sent","title":"Neue Wohnung","body":"3 Zimmer in 1070","payload":{},"matchReasons":null,\
        "matchedAt":"2026-03-01T10:00:00.000Z","sentAt":null,"createdAt":"2026-03-01T10:00:00.000Z",\
        "filterName":"Neubau","listing":null}
        """
        let alert = try XCTUnwrap(AlertStreamService.alert(from: ServerSentEvent(type: "alert", data: payload)))

        XCTAssertEqual(alert.id, 42)
        XCTAssertEqual(alert.alertType, .unknown)
        XCTAssertEqual(alert.status, .unread)
        XCTAssertEqual(alert.userFilterId, 5)
        XCTAssertNotNil(alert.matchedAt)

        let suppressed = payload.replacingOccurrences(of: "\"sent\"", with: "\"suppressed\"")
        XCTAssertEqual(
            AlertStreamService.alert(from: ServerSentEvent(type: "alert", data: suppressed))?.status,
            .suppressed
        )
        XCTAssertNil(AlertStreamService.alert(from: ServerSentEvent(type: "connected", data: payload)))
    }

    // MARK: - Delivery

    /// Two alerts published in one main-actor turn both reach every consumer, in order. Watching
    /// a "last event" property kept only the second one.
    @MainActor
    func testBackToBackAlertsReachEveryConsumer() async throws {
        let service = AlertStreamService()
        let appConsumer = service.alerts()
        let listConsumer = service.alerts()
        let first = try Self.alert(id: 1)
        let second = try Self.alert(id: 2)

        service.publish(first)
        service.publish(second)

        let appIDs = await Self.ids(in: appConsumer, count: 2)
        let listIDs = await Self.ids(in: listConsumer, count: 2)
        XCTAssertEqual(appIDs, [1, 2])
        XCTAssertEqual(listIDs, [1, 2])
    }

    /// The unread count goes up once per streamed alert, for two back to back and for a
    /// repeated delivery of the same one.
    @MainActor
    func testAlertsStateCountsEachStreamedAlertOnce() async throws {
        let suiteName = "AlertStreamParserTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let service = AlertStreamService()
        let state = AlertsState(defaults: defaults)
        state.startHandlingAlerts(from: service)
        let first = try Self.alert(id: 1)
        let second = try Self.alert(id: 2)

        service.publish(first)
        service.publish(second)
        var turns = 0
        while state.unreadAlertCount < 2, turns < 1_000 {
            await Task.yield()
            turns += 1
        }
        XCTAssertEqual(state.unreadAlertCount, 2)

        state.handleStreamAlert(first)
        XCTAssertEqual(state.unreadAlertCount, 2)
    }

    /// Streamed alerts go on top of the list once each, and only when they match the picked filter.
    @MainActor
    func testStreamedAlertsJoinTheListOnce() throws {
        let viewModel = AlertsViewModel()
        let first = try Self.alert(id: 1)
        let second = try Self.alert(id: 2)

        viewModel.insertStreamAlert(first)
        viewModel.insertStreamAlert(second)
        viewModel.insertStreamAlert(first)
        XCTAssertEqual(viewModel.alerts.map(\.id), [2, 1])

        viewModel.userFilterId = 9
        let otherFilter = try Self.alert(id: 3, userFilterId: 5)
        viewModel.insertStreamAlert(otherFilter)
        XCTAssertEqual(viewModel.alerts.map(\.id), [2, 1])
    }

    private static func alert(id: Int, userFilterId: Int = 5) throws -> Alert {
        let payload = """
        {"id":\(id),"userFilterId":\(userFilterId),"listingId":300,"alertType":"new_match","channel":"in_app",\
        "status":"sent","title":"Neue Wohnung","body":"3 Zimmer in 1070","payload":{},"matchReasons":null,\
        "matchedAt":"2026-03-01T10:00:00.000Z","sentAt":null,"createdAt":"2026-03-01T10:00:00.000Z",\
        "filterName":"Neubau","listing":null}
        """
        return try XCTUnwrap(AlertStreamService.alert(from: ServerSentEvent(type: "alert", data: payload)))
    }

    /// The ids of the first `count` alerts, or of fewer when the rest don't arrive within two
    /// seconds, so a lost alert fails the test instead of hanging it.
    @MainActor
    private static func ids(in stream: AsyncStream<Alert>, count: Int) async -> [Int] {
        let reader = Task { @MainActor in
            var ids: [Int] = []
            for await alert in stream {
                ids.append(alert.id)
                if ids.count == count { break }
            }
            return ids
        }
        // Cancelling the reader ends its wait for the next alert.
        let deadline = Task {
            try await Task.sleep(for: .seconds(2))
            reader.cancel()
        }
        defer { deadline.cancel() }
        return await reader.value
    }
}
