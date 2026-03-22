import Foundation
import os

/// SSE (Server-Sent Events) client for real-time alert streaming.
/// Connects to /v1/stream/alerts and emits parsed Alert objects.
@MainActor @Observable
final class AlertStreamService {

    // MARK: - State

    var isConnected: Bool = false
    var lastEvent: Alert?

    // MARK: - Private

    private var streamTask: Task<Void, Never>?
    private var backoffSeconds: Double = 1.0
    private static let maxBackoff: Double = 60.0

    // MARK: - Connect / Disconnect

    func connect(baseURL: String, token: String?) {
        guard streamTask == nil else { return }

        streamTask = Task { [weak self] in
            guard let self else { return }
            await self.runStream(baseURL: baseURL, token: token)
        }
    }

    func disconnect() {
        streamTask?.cancel()
        streamTask = nil
        isConnected = false
    }

    // MARK: - Stream Loop

    private func runStream(baseURL: String, token: String?) async {
        while !Task.isCancelled {
            do {
                try await openStream(baseURL: baseURL, token: token)
            } catch is CancellationError {
                break
            } catch {
                isConnected = false
                Log.stream.error("Disconnected: \(error, privacy: .public)")
            }

            guard !Task.isCancelled else { break }

            // Exponential backoff
            Log.stream.info("Reconnecting in \(self.backoffSeconds, format: .fixed(precision: 0))s...")
            try? await Task.sleep(for: .seconds(backoffSeconds))
            backoffSeconds = min(backoffSeconds * 2, Self.maxBackoff)
        }

        isConnected = false
    }

    private func openStream(baseURL: String, token: String?) async throws {
        guard let url = URL(string: baseURL + "/v1/stream/alerts") else { return }

        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        // Long timeout for SSE
        request.timeoutInterval = 300

        let (bytes, response) = try await URLSession.shared.bytes(for: request)

        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        isConnected = true
        backoffSeconds = 1.0 // Reset on successful connection
        Log.stream.info("Connected")

        var eventType = ""
        var dataBuffer = ""

        for try await line in bytes.lines {
            if Task.isCancelled { break }

            if line.isEmpty {
                // Empty line = end of event
                if !dataBuffer.isEmpty {
                    handleEvent(type: eventType, data: dataBuffer)
                }
                eventType = ""
                dataBuffer = ""
                continue
            }

            if line.hasPrefix(":") {
                // Comment (keepalive)
                continue
            }

            if line.hasPrefix("event:") {
                eventType = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                let value = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                if dataBuffer.isEmpty {
                    dataBuffer = value
                } else {
                    dataBuffer += "\n" + value
                }
            }
        }
    }

    // MARK: - Event Handling

    private func handleEvent(type: String, data: String) {
        switch type {
        case "connected":
            Log.stream.info("Server confirmed connection")

        case "alert":
            guard let jsonData = data.data(using: .utf8) else { return }
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            do {
                let dto = try decoder.decode(APIAlertResponse.self, from: jsonData)
                let alert = Alert(
                    id: dto.id,
                    alertType: AlertType(rawValue: dto.alertType) ?? .newMatch,
                    status: AlertStatus(rawValue: dto.status) ?? .unread,
                    title: dto.title,
                    body: dto.body,
                    matchedAt: Date.fromISO(dto.matchedAt),
                    filterName: dto.filterName,
                    listingId: dto.listingId
                )
                lastEvent = alert
            } catch {
                Log.stream.error("Failed to decode alert: \(error, privacy: .public)")
            }

        default:
            break
        }
    }
}
