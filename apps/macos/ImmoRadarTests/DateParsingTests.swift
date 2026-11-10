import Foundation
import XCTest
@testable import ImmoRadar

final class DateParsingTests: XCTestCase {
    func testFromISOReturnsNilForMissingOrInvalidInput() {
        XCTAssertNil(Date.fromISO(nil))
        XCTAssertNil(Date.fromISO("not-a-date"))
    }

    func testFromISOReturnsDateForValidTimestamp() {
        XCTAssertNotNil(Date.fromISO("2026-03-01T12:34:56.789Z"))
    }

    func testListingMappingPreservesInvalidFirstSeenDateAsNil() {
        let dto = APIListingResponse(
            id: 1,
            listingUid: "listing-1",
            sourceCode: "willhaben",
            title: "Sample Listing",
            canonicalUrl: "https://example.com/listing/1",
            operationType: OperationType.sale.rawValue,
            propertyType: PropertyType.apartment.rawValue,
            city: "Wien",
            postalCode: "1010",
            districtNo: 1,
            districtName: "Innere Stadt",
            listPriceEur: 250_000,
            listPriceEurCents: nil,
            livingAreaSqm: 60,
            rooms: 2,
            pricePerSqmEur: 4166.67,
            currentScore: 82,
            latitude: 48.2082,
            longitude: 16.3738,
            geocodePrecision: "source_exact",
            geocodeSource: "source",
            lastPriceChangePct: nil,
            lastPriceChangeAt: nil,
            firstSeenAt: "invalid-date",
            lastSeenAt: nil,
            listingStatus: ListingStatus.active.rawValue,
            contactName: nil,
            contactCompany: nil,
            contactEmail: nil,
            contactPhone: nil,
            outreachSummary: nil
        )

        let listing = dto.toDomain(decoder: JSONDecoder())

        XCTAssertNotNil(listing)
        XCTAssertNil(listing?.firstSeenAt)
    }

    func testAlertMappingPreservesInvalidMatchedDateAsNil() {
        let dto = APIAlertResponse(
            id: 1,
            userFilterId: nil,
            listingId: 123,
            alertType: AlertType.newMatch.rawValue,
            status: "sent",
            title: "Alert",
            body: "Body",
            matchedAt: "bad-date",
            filterName: "Value Filter",
            matchReasons: nil,
            listing: nil
        )

        let alert = dto.toDomain(decoder: JSONDecoder())

        XCTAssertNil(alert.matchedAt)
    }

    func testDistrictTrendParsedDateReturnsNilForMalformedInput() {
        let point = DistrictTrendPoint(
            districtNo: 1,
            date: "2026-13-42",
            avgMedianPpsqm: 5000,
            totalSamples: 10,
            avgP25: 4500,
            avgP75: 5500
        )

        XCTAssertNil(point.parsedDate)
    }

    /// The server sends trend and velocity days as Vienna calendar days. West of UTC, a UTC
    /// midnight falls on the previous local day, so the day must parse as local midnight.
    func testCalendarDayParsesAsLocalMidnight() throws {
        let losAngeles = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
        let date = try XCTUnwrap(Date.fromCalendarDay("2026-03-01", timeZone: losAngeles))

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = losAngeles
        let parts = calendar.dateComponents([.year, .month, .day, .hour], from: date)
        XCTAssertEqual(parts.year, 2026)
        XCTAssertEqual(parts.month, 3)
        XCTAssertEqual(parts.day, 1)
        XCTAssertEqual(parts.hour, 0)

        XCTAssertNil(Date.fromCalendarDay("2026-02-30", timeZone: losAngeles))
        XCTAssertNil(Date.fromCalendarDay("2026-03-01T00:00:00Z", timeZone: losAngeles))
    }

    func testMailboxResponseDecodesAndMapsLastSuccessfulSyncAt() throws {
        let payload = """
        {
          "data": [
            {
              "id": 10,
              "email": "shared@example.com",
              "display_name": "Shared Inbox",
              "sync_status": "healthy",
              "poll_interval_seconds": 60,
              "last_successful_sync_at": "2026-03-26T10:00:00Z",
              "last_error_message": null
            }
          ],
          "meta": {}
        }
        """

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(
            PaginatedResponse<APIMailboxResponse>.self,
            from: Data(payload.utf8)
        )

        let mailbox = response.data[0].toDomain()

        XCTAssertEqual(mailbox.email, "shared@example.com")
        XCTAssertEqual(mailbox.displayName, "Shared Inbox")
        XCTAssertEqual(mailbox.lastSuccessfulSyncAt, Date.fromISO("2026-03-26T10:00:00Z"))
    }

    func testOutreachThreadDetailDecodesMessagesEventsAndAttachments() throws {
        let payload = """
        {
          "data": {
            "id": 21,
            "listing_id": 300,
            "mailbox_account_id": 10,
            "contact_name": "Max Broker",
            "contact_company": "Broker GmbH",
            "contact_email": "broker@example.com",
            "contact_phone": "+431234567",
            "workflow_state": "reply_received",
            "unread_inbound_count": 2,
            "next_action_at": null,
            "last_inbound_at": "2026-03-29T10:00:00Z",
            "last_outbound_at": "2026-03-26T10:00:00Z",
            "updated_at": "2026-03-29T10:05:00Z",
            "messages": [
              {
                "id": 501,
                "direction": "outbound",
                "message_kind": "initial",
                "delivery_status": "sent",
                "subject": "Hallo",
                "body_text": "Interested",
                "body_html": null,
                "from_email": "shared@example.com",
                "to_email": "broker@example.com",
                "match_strategy": "manual",
                "occurred_at": "2026-03-26T10:00:00Z",
                "error_message": null,
                "attachments": []
              },
              {
                "id": 502,
                "direction": "inbound",
                "message_kind": "reply",
                "delivery_status": "received",
                "subject": "Re: Hallo",
                "body_text": "Bitte siehe Exposé",
                "body_html": "<p>Bitte siehe Exposé</p>",
                "from_email": "broker@example.com",
                "to_email": "shared@example.com",
                "match_strategy": "headers",
                "occurred_at": "2026-03-29T10:00:00Z",
                "error_message": null,
                "attachments": [
                  {
                    "document_id": 900,
                    "label": "Expose.pdf",
                    "status": "downloaded"
                  }
                ]
              }
            ],
            "events": [
              {
                "id": 700,
                "event_type": "reply_received",
                "from_state": "sent_waiting_reply",
                "to_state": "reply_received",
                "payload": {
                  "matchStrategy": "headers",
                  "providerMessageId": "reply-1"
                },
                "occurred_at": "2026-03-29T10:00:00Z"
              }
            ]
          },
          "meta": {}
        }
        """

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(
            APIResponse<APIOutreachThreadResponse>.self,
            from: Data(payload.utf8)
        )

        let thread = response.data.toDomain()

        XCTAssertEqual(thread.workflowState, "reply_received")
        XCTAssertEqual(thread.unreadInboundCount, 2)
        XCTAssertEqual(thread.messages.count, 2)
        XCTAssertEqual(thread.messages.last?.attachments.first?.label, "Expose.pdf")
        XCTAssertEqual(thread.events.first?.payload?["providerMessageId"], "reply-1")
    }
}

@MainActor
final class OutreachViewModelTests: XCTestCase {
    func testRefreshLoadsMailboxesDueFollowupsAndReplyTimeline() async {
        let viewModel = OutreachViewModel()
        let client = MockOutreachAPIClient(
            mailboxes: [makeMailbox()],
            threads: [makeThreadSummary(workflowState: "followup_due", unreadInboundCount: 2)],
            thread: makeThread(workflowState: "reply_received", unreadInboundCount: 2),
            listing: makeListing()
        )

        await viewModel.refresh(using: client)

        XCTAssertTrue(viewModel.hasLoaded)
        XCTAssertEqual(viewModel.mailboxes.count, 1)
        XCTAssertEqual(viewModel.threads.first?.workflowState, "followup_due")
        XCTAssertEqual(viewModel.threads.first?.unreadInboundCount, 2)
        XCTAssertEqual(viewModel.selectedThread?.workflowState, "reply_received")
        XCTAssertEqual(viewModel.selectedThread?.messages.count, 2)
        XCTAssertEqual(viewModel.selectedThread?.events.first?.eventType, "reply_received")
        XCTAssertEqual(viewModel.selectedListing?.id, 300)
        XCTAssertNil(viewModel.pageErrorMessage)
        XCTAssertNil(viewModel.detailErrorMessage)
    }

    func testSyncPrimaryMailboxQueuesSyncAndRefreshesState() async {
        let viewModel = OutreachViewModel()
        let client = MockOutreachAPIClient(
            mailboxes: [makeMailbox()],
            threads: [makeThreadSummary()],
            thread: makeThread(),
            listing: makeListing()
        )

        await viewModel.refresh(using: client)
        await viewModel.syncPrimaryMailbox(using: client)
        let snapshot = await client.snapshot()

        XCTAssertEqual(snapshot.syncMailboxCalls, [10])
        XCTAssertFalse(viewModel.isSyncingMailbox)
        XCTAssertNil(viewModel.pageErrorMessage)
    }

    func testPerformThreadActionCallsAPIAndClearsActionState() async {
        let viewModel = OutreachViewModel()
        let client = MockOutreachAPIClient(
            mailboxes: [makeMailbox()],
            threads: [makeThreadSummary()],
            thread: makeThread(),
            listing: makeListing()
        )

        await viewModel.refresh(using: client)
        await viewModel.performThreadAction(.pause, using: client)
        let snapshot = await client.snapshot()

        XCTAssertEqual(snapshot.updateCalls.count, 1)
        XCTAssertEqual(snapshot.updateCalls.first?.id, 21)
        XCTAssertEqual(snapshot.updateCalls.first?.action, .pause)
        XCTAssertNil(viewModel.actionInFlight)
        XCTAssertNil(viewModel.detailErrorMessage)
    }

    func testSendFollowupQueuesRequestAndResetsTransientState() async {
        let viewModel = OutreachViewModel()
        let client = MockOutreachAPIClient(
            mailboxes: [makeMailbox()],
            threads: [makeThreadSummary()],
            thread: makeThread(),
            listing: makeListing()
        )

        await viewModel.refresh(using: client)
        await viewModel.sendFollowup(using: client)
        let snapshot = await client.snapshot()

        XCTAssertEqual(snapshot.followupCalls, [21])
        XCTAssertNil(viewModel.actionInFlight)
        XCTAssertNil(viewModel.detailErrorMessage)
    }

    func testRefreshShowsUnavailableErrorWhenMailboxLoadFails() async {
        let viewModel = OutreachViewModel()
        let client = MockOutreachAPIClient(
            mailboxesError: MockOutreachError.mailboxes,
            threads: [],
            thread: makeThread(),
            listing: makeListing()
        )

        await viewModel.refresh(using: client)

        XCTAssertEqual(
            viewModel.pageErrorMessage,
            "Outreach is currently unavailable. Check mailbox configuration and try again."
        )
        XCTAssertTrue(viewModel.hasLoaded)
        XCTAssertFalse(viewModel.isLoadingList)
    }

    /// A 409 means the thread moved on: show the server's reason and reload the thread, so its
    /// buttons match what the server accepts now.
    func testConflictShowsServerMessageAndReloadsThread() async {
        let viewModel = OutreachViewModel()
        let client = MockOutreachAPIClient(
            mailboxes: [makeMailbox()],
            threads: [makeThreadSummary()],
            thread: makeThread(),
            listing: makeListing(),
            updateError: makeAPIError(
                status: 409,
                code: "conflict",
                message: "The thread changed in the meantime. Reload it and try again"
            )
        )

        await viewModel.refresh(using: client)
        await viewModel.performThreadAction(.pause, using: client)
        let fetchCount = await client.threadFetchCount()

        XCTAssertEqual(viewModel.actionFailure?.message, "The thread changed in the meantime. Reload it and try again")
        XCTAssertEqual(viewModel.actionFailure?.canTryAgain, false)
        XCTAssertEqual(fetchCount, 2, "The 409 should reload the thread")
        XCTAssertNil(viewModel.actionInFlight)
    }

    /// A 503 `outreach_enqueue_failed` leaves the thread as it was, so Try Again sends the same request.
    func testEnqueueFailureOffersTryAgainThatResendsFollowup() async {
        let viewModel = OutreachViewModel()
        let client = MockOutreachAPIClient(
            mailboxes: [makeMailbox()],
            threads: [makeThreadSummary()],
            thread: makeThread(),
            listing: makeListing(),
            followupError: makeAPIError(
                status: 503,
                code: "outreach_enqueue_failed",
                message: "Could not queue the follow-up. Try again in a moment"
            )
        )

        await viewModel.refresh(using: client)
        await viewModel.sendFollowup(using: client)

        XCTAssertEqual(viewModel.actionFailure?.message, "Could not queue the follow-up. Try again in a moment")
        XCTAssertEqual(viewModel.actionFailure?.canTryAgain, true)

        await viewModel.tryFailedRequestAgain(using: client)
        let snapshot = await client.snapshot()

        XCTAssertEqual(snapshot.followupCalls, [21, 21])
    }

    /// A refresh used to reload only the first page, so a thread picked from a later page lost
    /// its selection and the list lost the pages loaded with Load More.
    func testRefreshKeepsLaterPagesAndTheThreadPickedFromThem() async {
        let viewModel = OutreachViewModel()
        let pageSize = OutreachViewModel.pageSize
        let laterThreadID = 100 + pageSize
        let client = MockOutreachAPIClient(
            mailboxes: [makeMailbox()],
            threads: (100...laterThreadID).map { makeThreadSummary(id: $0) },
            thread: makeThread(),
            listing: makeListing()
        )

        await viewModel.refresh(using: client)
        await viewModel.loadMoreThreads(using: client)
        await viewModel.selectThread(id: laterThreadID, using: client)
        await viewModel.refresh(using: client)

        XCTAssertEqual(viewModel.threads.count, pageSize + 1)
        XCTAssertEqual(viewModel.selectedThreadID, laterThreadID)
        XCTAssertEqual(viewModel.selectedThread?.id, laterThreadID)
    }

    /// A refresh could move the selection to another thread and leave a failed request on
    /// screen, so Try Again sent that request for the thread selected now.
    func testRefreshThatMovesTheSelectionDropsTheFailedRequest() async {
        let viewModel = OutreachViewModel()
        let client = MockOutreachAPIClient(
            mailboxes: [makeMailbox()],
            threads: [makeThreadSummary(id: 21)],
            thread: makeThread(id: 21),
            listing: makeListing(),
            followupError: makeAPIError(
                status: 503,
                code: "outreach_enqueue_failed",
                message: "Could not queue the follow-up. Try again in a moment"
            )
        )

        await viewModel.refresh(using: client)
        await viewModel.sendFollowup(using: client)
        // Thread 21 left the scope shown, and the list has no more pages.
        await client.setThreads([makeThreadSummary(id: 22)])
        await viewModel.refresh(using: client)
        await viewModel.tryFailedRequestAgain(using: client)
        let snapshot = await client.snapshot()

        XCTAssertEqual(viewModel.selectedThreadID, 22)
        XCTAssertNil(viewModel.actionFailure)
        XCTAssertEqual(snapshot.followupCalls, [21])
    }

    /// A request could fail after the user picked another thread. The failure then showed under
    /// that thread, and Try Again sent the request for it.
    func testFailureThatArrivesAfterPickingAnotherThreadStaysWithItsThread() async {
        let viewModel = OutreachViewModel()
        let client = MockOutreachAPIClient(
            mailboxes: [makeMailbox()],
            threads: [makeThreadSummary(id: 21), makeThreadSummary(id: 22)],
            thread: makeThread(id: 21),
            listing: makeListing(),
            followupError: makeAPIError(
                status: 503,
                code: "outreach_enqueue_failed",
                message: "Could not queue the follow-up. Try again in a moment"
            )
        )

        await viewModel.refresh(using: client)
        // The user picks thread 22 while the follow-up for thread 21 is out.
        await client.setFollowupHook { client in
            await viewModel.selectThread(id: 22, using: client)
        }
        await viewModel.sendFollowup(using: client)
        await viewModel.tryFailedRequestAgain(using: client)
        let snapshot = await client.snapshot()

        XCTAssertEqual(viewModel.selectedThread?.id, 22)
        XCTAssertEqual(viewModel.actionFailure?.threadID, 21)
        XCTAssertNil(viewModel.shownActionFailure)
        XCTAssertEqual(snapshot.followupCalls, [21])
    }

    /// A link to a thread could arrive while another scope's list loaded. That list then
    /// replaced the All list the link had opened, so the picker said All over the Open threads.
    func testLinkThatArrivesDuringAScopeChangeShowsTheAllList() async {
        let viewModel = OutreachViewModel()
        let client = MockOutreachAPIClient(
            mailboxes: [makeMailbox()],
            threads: [makeThreadSummary(id: 21), makeThreadSummary(id: 30, workflowState: "closed")],
            thread: makeThread(id: 21),
            listing: makeListing()
        )

        viewModel.selectedScope = .all
        await viewModel.refresh(using: client)
        // The user picks Open, and a link to closed thread 30 arrives while that list loads.
        await client.setThreadsHook { client in
            await viewModel.openThread(id: 30, using: client)
        }
        viewModel.selectedScope = .open
        await viewModel.refresh(using: client)

        XCTAssertEqual(viewModel.selectedScope, .all)
        XCTAssertEqual(viewModel.threads.map(\.id), [21, 30])
        XCTAssertEqual(viewModel.selectedThreadID, 30)
        XCTAssertEqual(viewModel.selectedThread?.id, 30)
    }
}

private func makeAPIError(status: Int, code: String, message: String) -> APIError {
    .httpError(statusCode: status, detail: APIErrorDetail(code: code, message: message, details: nil))
}

private enum MockOutreachError: Error {
    case mailboxes
    case threads
    case thread
    case listing
    case sync
    case update
    case followup
}

private actor MockOutreachAPIClient: OutreachAPIClient {
    struct Snapshot: Sendable {
        let syncMailboxCalls: [Int]
        let updateCalls: [(id: Int, action: OutreachAction)]
        let followupCalls: [Int]
    }

    private let mailboxes: [MailboxAccount]
    private let mailboxesError: Error?
    private var threads: [OutreachThreadSummary]
    private let threadsError: Error?
    private let thread: OutreachThread
    private let threadError: Error?
    private let listing: Listing
    private let listingError: Error?
    private let syncError: Error?
    private let updateError: Error?
    private let followupError: Error?

    private var syncMailboxCallsStorage: [Int] = []
    private var updateCallsStorage: [(id: Int, action: OutreachAction)] = []
    private var followupCallsStorage: [Int] = []
    private var threadFetchCountStorage = 0
    /// Runs once inside the next follow-up request, before it answers, so a test can act while
    /// the request is out.
    private var followupHook: (@Sendable (MockOutreachAPIClient) async -> Void)?
    /// Runs once inside the next thread list request, before it answers.
    private var threadsHook: (@Sendable (MockOutreachAPIClient) async -> Void)?

    init(
        mailboxes: [MailboxAccount] = [],
        mailboxesError: Error? = nil,
        threads: [OutreachThreadSummary],
        threadsError: Error? = nil,
        thread: OutreachThread,
        threadError: Error? = nil,
        listing: Listing,
        listingError: Error? = nil,
        syncError: Error? = nil,
        updateError: Error? = nil,
        followupError: Error? = nil
    ) {
        self.mailboxes = mailboxes
        self.mailboxesError = mailboxesError
        self.threads = threads
        self.threadsError = threadsError
        self.thread = thread
        self.threadError = threadError
        self.listing = listing
        self.listingError = listingError
        self.syncError = syncError
        self.updateError = updateError
        self.followupError = followupError
    }

    func fetchMailboxes() async throws -> [MailboxAccount] {
        if let mailboxesError { throw mailboxesError }
        return mailboxes
    }

    /// Pages through the threads `scope` lists, like the server. A cursor is the offset of the
    /// next page.
    func fetchOutreachThreads(
        scope: OutreachScope,
        cursor: String?,
        limit: Int?
    ) async throws -> (threads: [OutreachThreadSummary], nextCursor: String?) {
        if let threadsError { throw threadsError }
        if let hook = threadsHook {
            threadsHook = nil
            await hook(self)
        }
        let listed = threads.filter { thread in
            switch scope {
            case .open: thread.workflowState != "closed"
            case .closed: thread.workflowState == "closed"
            case .all: true
            }
        }
        let start = min(cursor.flatMap { Int($0) } ?? 0, listed.count)
        let end = min(start + (limit ?? listed.count), listed.count)
        return (Array(listed[start..<end]), end < listed.count ? String(end) : nil)
    }

    /// Replaces the threads the server lists from now on.
    func setThreads(_ newThreads: [OutreachThreadSummary]) {
        threads = newThreads
    }

    func setThreadsHook(_ hook: @escaping @Sendable (MockOutreachAPIClient) async -> Void) {
        threadsHook = hook
    }

    func fetchOutreachThread(id: Int) async throws -> OutreachThread {
        threadFetchCountStorage += 1
        if let threadError { throw threadError }
        return id == thread.id ? thread : makeThread(id: id)
    }

    func threadFetchCount() -> Int {
        threadFetchCountStorage
    }

    func fetchListing(id: Int) async throws -> Listing {
        _ = id
        if let listingError { throw listingError }
        return listing
    }

    func syncMailbox(id: Int) async throws {
        syncMailboxCallsStorage.append(id)
        if let syncError { throw syncError }
    }

    func updateOutreachThread(id: Int, action: OutreachAction) async throws {
        updateCallsStorage.append((id, action))
        if let updateError { throw updateError }
    }

    func sendOutreachFollowup(id: Int, subject: String?, bodyText: String?) async throws {
        _ = subject
        _ = bodyText
        followupCallsStorage.append(id)
        if let hook = followupHook {
            followupHook = nil
            await hook(self)
        }
        if let followupError { throw followupError }
    }

    func setFollowupHook(_ hook: @escaping @Sendable (MockOutreachAPIClient) async -> Void) {
        followupHook = hook
    }

    func snapshot() -> Snapshot {
        Snapshot(
            syncMailboxCalls: syncMailboxCallsStorage,
            updateCalls: updateCallsStorage,
            followupCalls: followupCallsStorage
        )
    }
}

private func makeMailbox() -> MailboxAccount {
    MailboxAccount(
        id: 10,
        email: "shared@example.com",
        displayName: "Shared Inbox",
        syncStatus: "healthy",
        pollIntervalSeconds: 60,
        lastSuccessfulSyncAt: Date.fromISO("2026-03-26T10:00:00Z"),
        lastErrorMessage: nil
    )
}

private func makeThreadSummary(
    id: Int = 21,
    workflowState: String = "sent_waiting_reply",
    unreadInboundCount: Int = 1
) -> OutreachThreadSummary {
    OutreachThreadSummary(
        id: id,
        listingId: 300,
        mailboxAccountId: 10,
        contactName: "Max Broker",
        contactCompany: "Broker GmbH",
        contactEmail: "broker@example.com",
        contactPhone: "+431234567",
        workflowState: workflowState,
        unreadInboundCount: unreadInboundCount,
        nextActionAt: Date.fromISO("2026-03-29T10:00:00Z"),
        lastInboundAt: workflowState == "reply_received" ? Date.fromISO("2026-03-29T10:00:00Z") : nil,
        lastOutboundAt: Date.fromISO("2026-03-26T10:00:00Z"),
        updatedAt: Date.fromISO("2026-03-29T10:05:00Z")
    )
}

private func makeThread(
    id: Int = 21,
    workflowState: String = "sent_waiting_reply",
    unreadInboundCount: Int = 1
) -> OutreachThread {
    OutreachThread(
        id: id,
        listingId: 300,
        mailboxAccountId: 10,
        contactName: "Max Broker",
        contactCompany: "Broker GmbH",
        contactEmail: "broker@example.com",
        contactPhone: "+431234567",
        workflowState: workflowState,
        unreadInboundCount: unreadInboundCount,
        nextActionAt: Date.fromISO("2026-03-29T10:00:00Z"),
        lastInboundAt: workflowState == "reply_received" ? Date.fromISO("2026-03-29T10:00:00Z") : nil,
        lastOutboundAt: Date.fromISO("2026-03-26T10:00:00Z"),
        updatedAt: Date.fromISO("2026-03-29T10:05:00Z"),
        messages: [
            OutreachMessage(
                id: 501,
                direction: "outbound",
                messageKind: "initial",
                deliveryStatus: "sent",
                subject: "Hallo",
                bodyText: "Interested",
                bodyHtml: nil,
                fromEmail: "shared@example.com",
                toEmail: "broker@example.com",
                matchStrategy: "manual",
                occurredAt: Date.fromISO("2026-03-26T10:00:00Z"),
                errorMessage: nil,
                attachments: []
            ),
            OutreachMessage(
                id: 502,
                direction: "inbound",
                messageKind: "reply",
                deliveryStatus: "received",
                subject: "Re: Hallo",
                bodyText: "Bitte siehe Exposé",
                bodyHtml: "<p>Bitte siehe Exposé</p>",
                fromEmail: "broker@example.com",
                toEmail: "shared@example.com",
                matchStrategy: "headers",
                occurredAt: Date.fromISO("2026-03-29T10:00:00Z"),
                errorMessage: nil,
                attachments: [
                    OutreachAttachment(documentId: 900, label: "Expose.pdf", status: "downloaded")
                ]
            )
        ],
        events: [
            OutreachEvent(
                id: 700,
                eventType: "reply_received",
                fromState: "sent_waiting_reply",
                toState: "reply_received",
                payload: ["providerMessageId": "reply-1"],
                occurredAt: Date.fromISO("2026-03-29T10:00:00Z")
            )
        ]
    )
}

private func makeListing() -> Listing {
    Listing(
        id: 300,
        listingUid: "listing-300",
        sourceCode: "willhaben",
        title: "Sanierte Altbauwohnung mit Garten",
        canonicalUrl: "https://example.com/listings/300",
        operationType: .sale,
        propertyType: .apartment,
        city: "Wien",
        postalCode: "1070",
        districtNo: 7,
        districtName: "Neubau",
        listPriceEur: 450_000,
        livingAreaSqm: 88,
        rooms: 3,
        pricePerSqmEur: 5113.64,
        currentScore: 84,
        latitude: 48.201,
        longitude: 16.354,
        geocodePrecision: "source_exact",
        geocodeSource: "source",
        lastPriceChangePct: nil,
        lastPriceChangeAt: nil,
        firstSeenAt: Date.fromISO("2026-03-25T10:00:00Z"),
        listingStatus: .active,
        contactName: "Max Broker",
        contactCompany: "Broker GmbH",
        contactEmail: "broker@example.com",
        contactPhone: "+431234567",
        outreachSummary: nil
    )
}
