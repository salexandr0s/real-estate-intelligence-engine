import Foundation

// The thread actions the server accepts, so each button is enabled only when its request can go
// through. Mirrors the PATCH and follow-up routes in apps/api/src/routes/outreach.ts and the state
// machine in packages/outreach/src/machine.ts; change them together.
extension OutreachThread {
    /// Pause applies while a send is queued or the thread waits on the contact.
    var canPause: Bool {
        Self.pausableStates.contains(workflowState)
    }

    /// Resume applies only to a paused thread.
    var canResume: Bool {
        workflowState == "paused"
    }

    /// Close applies to every thread that isn't closed yet.
    var canClose: Bool {
        workflowState != "closed"
    }

    /// Retry sends a failed or due email again. On a thread that is still queued it queues the
    /// send again, in case the job was lost. The server answers 409 in every other state.
    var canRetry: Bool {
        Self.retryableStates.contains(workflowState)
    }

    /// A manual follow-up goes out once, while the thread waits on a reply to a sent first email.
    var canSendFollowup: Bool {
        guard lastInboundAt == nil, Self.followupStates.contains(workflowState) else { return false }
        let outbound = messages.filter { $0.direction == "outbound" }
        let initialWasSent = outbound.contains { $0.messageKind == "initial" && $0.deliveryStatus == "sent" }
        // The server refuses once its follow-up counter is above zero. The thread payload leaves
        // the counter out, so a sent follow-up message stands in for it.
        let followupWasSent = outbound.contains { $0.messageKind == "followup" && $0.deliveryStatus == "sent" }
        return initialWasSent && !followupWasSent
    }

    private static let pausableStates: Set<String> = ["queued_send", "sent_waiting_reply", "followup_due", "followup_sent"]
    private static let retryableStates: Set<String> = ["failed", "followup_due", "queued_send"]
    private static let followupStates: Set<String> = ["sent_waiting_reply", "followup_due"]
}

/// A thread request started from a button.
enum OutreachThreadRequest: Equatable {
    case start
    case action(OutreachAction)
    case followup

    /// Names what failed, above the server's reason.
    var failureTitle: String {
        switch self {
        case .start: "Couldn’t start outreach"
        case .action(.pause): "Couldn’t pause the thread"
        case .action(.resume): "Couldn’t resume the thread"
        case .action(.close): "Couldn’t close the thread"
        case .action(.retry): "Couldn’t retry the send"
        case .followup: "Couldn’t send the follow-up"
        }
    }
}

/// A thread request that failed, with the server's reason.
struct OutreachRequestFailure: Equatable {
    let request: OutreachThreadRequest
    /// The thread the request was sent for, nil for a start.
    let threadID: Int?
    /// The server's message, or a generic one when no answer came back.
    let message: String
    /// 409: the thread's state doesn't allow the request. It changed since it loaded or, for a
    /// start, a thread is already open. Reload it so the buttons match what the server accepts.
    let isConflict: Bool
    /// 503 `outreach_enqueue_failed`: the server couldn't queue the email.
    let enqueueFailed: Bool

    init(request: OutreachThreadRequest, threadID: Int?, error: Error) {
        let apiError = error as? APIError
        self.request = request
        self.threadID = threadID
        message = apiError.map { AppErrorPresentation.message(for: $0) } ?? "Try again in a moment."
        isConflict = apiError?.statusCode == 409
        enqueueFailed = apiError?.statusCode == 503 && apiError?.serverCode == "outreach_enqueue_failed"
    }

    /// Whether sending the same request again can work. After a failed queue the server puts the
    /// thread back as it was, so it can. A start is the exception: the server keeps that thread as
    /// failed, and Retry on the thread sends it.
    var canTryAgain: Bool {
        enqueueFailed && request != .start
    }
}
