import XCTest
@testable import ImmoRadar

/// The thread buttons must offer what the server accepts (apps/api/src/routes/outreach.ts).
final class OutreachActionRulesTests: XCTestCase {
    func testRetryIsOfferedForFailedDueAndStillQueuedThreads() {
        for state in ["failed", "followup_due", "queued_send"] {
            XCTAssertTrue(makeThread(state: state).canRetry, state)
        }
        for state in ["draft", "sent_waiting_reply", "followup_sent", "reply_received", "paused", "closed"] {
            XCTAssertFalse(makeThread(state: state).canRetry, state)
        }
    }

    func testFollowupNeedsSentFirstEmailAndNoReplyOrEarlierFollowup() {
        XCTAssertTrue(makeThread(state: "sent_waiting_reply").canSendFollowup)
        XCTAssertTrue(makeThread(state: "followup_due").canSendFollowup)
        XCTAssertFalse(makeThread(state: "sent_waiting_reply", repliedAt: Date()).canSendFollowup)
        XCTAssertFalse(makeThread(state: "sent_waiting_reply", initialStatus: "queued").canSendFollowup)
        XCTAssertFalse(makeThread(state: "sent_waiting_reply", sentFollowup: true).canSendFollowup)
        XCTAssertFalse(makeThread(state: "followup_sent").canSendFollowup)
        XCTAssertFalse(makeThread(state: "paused").canSendFollowup)
    }
}

private func makeThread(
    state: String,
    repliedAt: Date? = nil,
    initialStatus: String = "sent",
    sentFollowup: Bool = false
) -> OutreachThread {
    var messages = [makeOutboundMessage(id: 1, kind: "initial", status: initialStatus)]
    if sentFollowup {
        messages.append(makeOutboundMessage(id: 2, kind: "followup", status: "sent"))
    }
    return OutreachThread(
        id: 21,
        listingId: 300,
        mailboxAccountId: 10,
        contactName: nil,
        contactCompany: nil,
        contactEmail: "broker@example.com",
        contactPhone: nil,
        workflowState: state,
        unreadInboundCount: 0,
        nextActionAt: nil,
        lastInboundAt: repliedAt,
        lastOutboundAt: nil,
        updatedAt: nil,
        messages: messages,
        events: []
    )
}

private func makeOutboundMessage(id: Int, kind: String, status: String) -> OutreachMessage {
    OutreachMessage(
        id: id,
        direction: "outbound",
        messageKind: kind,
        deliveryStatus: status,
        subject: "Anfrage",
        bodyText: nil,
        bodyHtml: nil,
        fromEmail: nil,
        toEmail: nil,
        matchStrategy: "manual",
        occurredAt: nil,
        errorMessage: nil,
        attachments: []
    )
}
