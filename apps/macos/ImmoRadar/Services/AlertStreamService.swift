import Foundation
import os

/// Keeps a connection to GET /v1/stream/alerts open and hands each alert it delivers to every
/// consumer of `alerts()`. A failed or closed connection reconnects with capped exponential
/// backoff. A 401 stops the stream and sets `isUnauthorized` until the next `connect`.
@MainActor @Observable
final class AlertStreamService {

    // MARK: - State

    /// True while a connection is open.
    private(set) var isConnected = false
    /// True once the server rejected the token. Nothing reconnects until `connect` runs again.
    private(set) var isUnauthorized = false

    // MARK: - Private

    private var streamTask: Task<Void, Never>?
    /// Whether the connection being read delivered an event, the server's `connected` included.
    @ObservationIgnored
    private var connectionDeliveredEvent = false
    /// One continuation per `alerts()` stream. Each buffers without limit, so alerts that arrive
    /// together all reach a consumer that is busy.
    @ObservationIgnored
    private var consumers: [UUID: AsyncStream<Alert>.Continuation] = [:]
    private static let initialBackoffSeconds: Double = 1
    private static let maxBackoffSeconds: Double = 60
    /// The server sends a keepalive every 30 seconds, so a connection silent for 90 is dead.
    private static let idleTimeout: TimeInterval = 90

    // MARK: - Connect / Disconnect

    /// Opens the stream unless one is already running or retrying.
    func connect(baseURL: String, token: String?) {
        guard streamTask == nil else { return }
        guard let url = URL(string: baseURL + "/v1/stream/alerts") else {
            Log.stream.error("The alert stream URL isn't valid")
            return
        }

        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = Self.idleTimeout

        isUnauthorized = false
        streamTask = Task { [weak self] in
            await self?.run(request)
        }
    }

    func disconnect() {
        streamTask?.cancel()
        streamTask = nil
        isConnected = false
    }

    // MARK: - Stream Loop

    /// Reconnects until cancelled or rejected. A cancelled run changes no state, because
    /// `disconnect` already set it and a newer stream may own it.
    private func run(_ request: URLRequest) async {
        var backoffSeconds = Self.initialBackoffSeconds

        while !Task.isCancelled {
            connectionDeliveredEvent = false
            do {
                try await Self.readStream(
                    request,
                    onOpen: { [weak self] in
                        guard !Task.isCancelled else { return }
                        self?.isConnected = true
                        Log.stream.info("Connected")
                    },
                    onEvent: { [weak self] event in
                        guard !Task.isCancelled else { return }
                        self?.connectionDeliveredEvent = true
                        self?.handle(event)
                    }
                )
                guard !Task.isCancelled else { return }
                Log.stream.info("The server closed the stream")
            } catch APIError.unauthorized {
                guard !Task.isCancelled else { return }
                Log.stream.error("The server rejected the token, so the stream stays closed")
                isConnected = false
                isUnauthorized = true
                streamTask = nil
                return
            } catch {
                guard !Task.isCancelled else { return }
                Log.stream.error("The stream failed: \(error, privacy: .public)")
            }

            // After a connection that delivered an event, the next attempt starts at the shortest
            // delay. One the server accepted and closed before sending anything keeps backing off.
            if connectionDeliveredEvent {
                backoffSeconds = Self.initialBackoffSeconds
            }
            isConnected = false

            Log.stream.info("Reconnecting in \(backoffSeconds, format: .fixed(precision: 0))s")
            do {
                try await Task.sleep(for: .seconds(backoffSeconds))
            } catch {
                return
            }
            backoffSeconds = min(backoffSeconds * 2, Self.maxBackoffSeconds)
        }
    }

    /// Opens one connection and passes its events to `onEvent` until the server closes it.
    /// Reads and parses off the main actor; only the callbacks run on it.
    private nonisolated static func readStream(
        _ request: URLRequest,
        onOpen: @MainActor @Sendable () -> Void,
        onEvent: @MainActor @Sendable (ServerSentEvent) -> Void
    ) async throws {
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard statusCode == 200 else {
            bytes.task.cancel()
            throw statusCode == 401
                ? APIError.unauthorized
                : APIError.httpError(statusCode: statusCode, detail: nil)
        }

        await onOpen()
        var parser = ServerSentEventParser()
        for try await byte in bytes {
            if let event = parser.feed(byte) {
                await onEvent(event)
            }
        }
    }

    // MARK: - Delivery

    /// Every alert delivered from now on, once each and in order. Each call returns a stream of
    /// its own, so one consumer can't take an alert from another. The stream ends when the task
    /// iterating it is cancelled.
    func alerts() -> AsyncStream<Alert> {
        let (stream, continuation) = AsyncStream.makeStream(of: Alert.self)
        let id = UUID()
        consumers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor in
                self?.consumers[id] = nil
            }
        }
        return stream
    }

    /// Hands one alert to every consumer of `alerts()`.
    func publish(_ alert: Alert) {
        for continuation in consumers.values {
            continuation.yield(alert)
        }
    }

    // MARK: - Event Handling

    private func handle(_ event: ServerSentEvent) {
        switch event.type {
        case "alert":
            if let alert = Self.alert(from: event) {
                publish(alert)
            }
        case "connected":
            Log.stream.info("The server confirmed the connection")
        default:
            break
        }
    }

    /// The alert an `alert` event carries, in the DTO GET /v1/alerts returns. Nil for any other
    /// event and for a payload that doesn't decode.
    nonisolated static func alert(from event: ServerSentEvent) -> Alert? {
        guard event.type == "alert" else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        do {
            let dto = try decoder.decode(APIAlertResponse.self, from: Data(event.data.utf8))
            return dto.toDomain(decoder: decoder)
        } catch {
            Log.stream.error("An alert event didn't decode: \(error, privacy: .public)")
            return nil
        }
    }
}
