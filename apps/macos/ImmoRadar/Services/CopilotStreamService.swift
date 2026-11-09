import Foundation
import os

// MARK: - Request

/// The body `POST /v1/copilot/chat` takes.
struct CopilotChatRequest: Encodable, Sendable {
    struct Message: Encodable, Equatable, Sendable {
        let role: String
        let content: String
    }

    struct Context: Encodable, Sendable {
        let currentListingId: Int?
        let currentDistrictNo: Int?
    }

    /// The route refuses a chat with more messages than this.
    static let maxMessages = 50

    let messages: [Message]
    let context: Context?
    let provider: String
    let model: String?

    /// The most recent messages the route accepts. The history starts on a user turn, because a
    /// cut that leaves an assistant turn first gives the model an answer to a question it never saw.
    static func history(from messages: [CopilotMessage], limit: Int = maxMessages) -> [Message] {
        var recent = Array(messages.suffix(limit))
        while let first = recent.first, first.role != .user {
            recent.removeFirst()
        }
        return recent.map { Message(role: $0.role.rawValue, content: requestContent(for: $0)) }
    }

    /// The message's text. An answer that was only cards is described in words: the route turns
    /// empty text into a placeholder, which would tell the model nothing about what it showed.
    static func requestContent(for message: CopilotMessage) -> String {
        let text = message.contentBlocks
            .compactMap { block -> String? in
                if case .text(let value) = block.content { return value }
                return nil
            }
            .joined(separator: "\n\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.isEmpty else { return text }

        let cards = message.contentBlocks.compactMap { cardSummary(for: $0.content) }
        guard !cards.isEmpty else { return "(No answer.)" }
        return "Shown as cards in the app:\n" + cards.joined(separator: "\n")
    }

    private static func cardSummary(for content: ContentBlockType) -> String? {
        switch content {
        case .text, .loading:
            return nil
        case .listingCards(let listings):
            return "Listings: " + listings.map { "#\($0.id) \($0.title)" }.joined(separator: "; ")
        case .comparisonTable:
            return "A comparison table"
        case .scoreBreakdown(let breakdown):
            return "The score breakdown for listing #\(breakdown.listingId)"
        case .priceHistory(let history):
            return "The price history for listing #\(history.listingId)"
        case .chartData(let chart):
            return "A chart: \(chart.title)"
        case .marketStats:
            return "Market statistics"
        case .listingComparison:
            return "A comparison of listings"
        case .proximitySummary:
            return "A summary of nearby places"
        case .crossSourceComparison:
            return "The same listing on other sources"
        }
    }
}

// MARK: - Stream Service

/// SSE client for copilot chat streaming responses.
/// Unlike AlertStreamService (long-lived GET), this is request-response via POST.
final class CopilotStreamService: Sendable {

    /// The largest error body read from a failed answer.
    private static let errorBodyLimit = 64 * 1024

    func stream(
        baseURL: String,
        token: String,
        request chatRequest: CopilotChatRequest,
        copilotApiKey: String
    ) -> AsyncThrowingStream<CopilotStreamEvent, Error> {
        let bodyData: Data
        do {
            bodyData = try JSONEncoder().encode(chatRequest)
        } catch {
            return AsyncThrowingStream { $0.finish(throwing: error) }
        }

        let urlString = baseURL + "/v1/copilot/chat"
        let authHeader = "Bearer \(token)"
        let copilotKeyHeader = copilotApiKey

        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let url = URL(string: urlString) else {
                        continuation.finish(throwing: URLError(.badURL))
                        return
                    }

                    var request = URLRequest(url: url)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue(authHeader, forHTTPHeaderField: "Authorization")
                    if !copilotKeyHeader.isEmpty {
                        request.setValue(copilotKeyHeader, forHTTPHeaderField: "X-Copilot-Api-Key")
                    }
                    request.timeoutInterval = 120
                    request.httpBody = bodyData

                    let (bytes, response) = try await URLSession.shared.bytes(for: request)

                    guard let http = response as? HTTPURLResponse else {
                        continuation.finish(throwing: URLError(.badServerResponse))
                        return
                    }

                    guard (200..<300).contains(http.statusCode) else {
                        var body = Data()
                        for try await byte in bytes {
                            body.append(byte)
                            if body.count >= Self.errorBodyLimit { break }
                        }
                        continuation.yield(.error(Self.failureMessage(statusCode: http.statusCode, body: body)))
                        continuation.finish()
                        return
                    }

                    var eventType = ""
                    var dataBuffer = ""

                    for try await line in bytes.lines {
                        if Task.isCancelled { break }

                        if line.isEmpty {
                            // Empty line = event boundary (standard SSE).
                            // Note: AsyncBytes.lines often skips empty lines,
                            // so we also dispatch on seeing a new "event:" line below.
                            if !dataBuffer.isEmpty {
                                if let event = Self.parseEvent(type: eventType, data: dataBuffer) {
                                    continuation.yield(event)
                                    if case .done = event { break }
                                }
                            }
                            eventType = ""
                            dataBuffer = ""
                            continue
                        }

                        if line.hasPrefix(":") {
                            continue // SSE comment / keepalive
                        }

                        if line.hasPrefix("event:") {
                            // Dispatch the previous event if we have buffered data,
                            // since AsyncBytes.lines skips empty lines between events.
                            if !dataBuffer.isEmpty {
                                if let event = Self.parseEvent(type: eventType, data: dataBuffer) {
                                    continuation.yield(event)
                                    if case .done = event { break }
                                }
                                dataBuffer = ""
                            }
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

                    // Dispatch any remaining buffered event
                    if !dataBuffer.isEmpty {
                        if let event = Self.parseEvent(type: eventType, data: dataBuffer) {
                            continuation.yield(event)
                        }
                    }

                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    // MARK: - Errors

    /// The `message` of the API's error envelope, `{"error":{"code":…,"message":…,"details":…}}`,
    /// or the status when the answer has no envelope.
    static func failureMessage(statusCode: Int, body: Data) -> String {
        if let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: body) {
            let message = envelope.error.message.trimmingCharacters(in: .whitespacesAndNewlines)
            if !message.isEmpty { return message }
        }
        return "Copilot couldn't start. The server answered with HTTP \(statusCode)."
    }

    /// `details` can hold any JSON, so only the message is decoded.
    private struct ErrorEnvelope: Decodable {
        struct Detail: Decodable {
            let message: String
        }

        let error: Detail
    }

    // MARK: - Event Parsing

    private struct TextDeltaPayload: Decodable {
        let delta: String
    }

    /// Decoded from snake case, so `tool_name` works as well as `toolName`.
    private struct ToolUsePayload: Decodable {
        let toolName: String
    }

    private struct MessagePayload: Decodable {
        let message: String
    }

    private struct BlockTypePayload: Decodable {
        let type: String
    }

    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private static func parseEvent(type: String, data: String) -> CopilotStreamEvent? {
        let jsonData = Data(data.utf8)
        let decoder = makeDecoder()

        switch type {
        case "text_delta":
            guard let payload = try? decoder.decode(TextDeltaPayload.self, from: jsonData) else { return nil }
            return .textDelta(payload.delta)

        case "tool_use":
            guard let payload = try? decoder.decode(ToolUsePayload.self, from: jsonData) else { return nil }
            return .toolUse(name: payload.toolName)

        case "content_block":
            return parseContentBlock(data: jsonData, decoder: decoder)

        case "done":
            return .done

        case "error":
            let payload = try? decoder.decode(MessagePayload.self, from: jsonData)
            return .error(payload?.message ?? "Copilot hit an error and stopped. Try again.")

        default:
            Log.stream.debug("Unknown copilot event type: \(type, privacy: .public)")
            return nil
        }
    }

    // MARK: - Content Block Parsing

    private static func parseContentBlock(data jsonData: Data, decoder: JSONDecoder) -> CopilotStreamEvent? {
        guard let blockType = (try? decoder.decode(BlockTypePayload.self, from: jsonData))?.type else {
            return nil
        }

        do {
            switch blockType {
            case "listing_cards":
                let wrapper = try decoder.decode(ListingCardsWrapper.self, from: jsonData)
                return .contentBlock(ContentBlock(.listingCards(wrapper.listings)))

            case "comparison_table":
                let table = try decoder.decode(ComparisonTableWrapper.self, from: jsonData)
                return .contentBlock(ContentBlock(.comparisonTable(
                    ComparisonTableData(headers: table.headers, rows: table.rows)
                )))

            case "score_breakdown":
                let breakdown = try decoder.decode(ScoreBreakdownWrapper.self, from: jsonData)
                return .contentBlock(ContentBlock(.scoreBreakdown(ScoreBreakdownData(
                    listingId: breakdown.listingId,
                    overall: breakdown.overall,
                    components: breakdown.components,
                    discountToDistrictPct: breakdown.discountToDistrictPct,
                    discountToBucketPct: breakdown.discountToBucketPct,
                    positiveKeywords: breakdown.positiveKeywords,
                    negativeKeywords: breakdown.negativeKeywords
                ))))

            case "price_history":
                let history = try decoder.decode(PriceHistoryWrapper.self, from: jsonData)
                return .contentBlock(ContentBlock(.priceHistory(PriceHistoryData(
                    listingId: history.listingId,
                    dataPoints: history.dataPoints
                ))))

            case "chart_data":
                let chart = try decoder.decode(ChartBlockWrapper.self, from: jsonData)
                return .contentBlock(ContentBlock(.chartData(ChartBlockData(
                    chartType: ChartBlockData.ChartType(rawValue: chart.chartType) ?? .line,
                    title: chart.title,
                    series: chart.series
                ))))

            case "market_stats":
                let stats = try decoder.decode(MarketStatsWrapper.self, from: jsonData)
                return .contentBlock(ContentBlock(.marketStats(stats.stats)))

            case "listing_comparison":
                let comparison = try decoder.decode(ListingComparisonData.self, from: jsonData)
                return .contentBlock(ContentBlock(.listingComparison(comparison)))

            case "proximity_summary":
                let summary = try decoder.decode(ProximitySummaryData.self, from: jsonData)
                return .contentBlock(ContentBlock(.proximitySummary(summary)))

            case "cross_source_comparison":
                let comparison = try decoder.decode(CrossSourceComparisonData.self, from: jsonData)
                return .contentBlock(ContentBlock(.crossSourceComparison(comparison)))

            default:
                Log.stream.debug("Unknown content block type: \(blockType, privacy: .public)")
                return nil
            }
        } catch {
            Log.stream.error("Failed to decode content block '\(blockType, privacy: .public)': \(error, privacy: .public)")
            return nil
        }
    }
}

// MARK: - Decode Wrappers

/// Thin wrappers for JSONDecoder since ContentBlock is not directly Codable.
private struct ListingCardsWrapper: Codable {
    let listings: [CopilotListing]
}

private struct ComparisonTableWrapper: Codable {
    let headers: [String]
    let rows: [ComparisonRow]
}

private struct ScoreBreakdownWrapper: Codable {
    let listingId: Int
    let overall: Double
    let components: [ScoreComponent]
    let discountToDistrictPct: Double?
    let discountToBucketPct: Double?
    let positiveKeywords: [String]?
    let negativeKeywords: [String]?
}

private struct PriceHistoryWrapper: Codable {
    let listingId: Int
    let dataPoints: [PricePoint]
}

private struct ChartBlockWrapper: Codable {
    let chartType: String
    let title: String
    let series: [ChartSeries]
}

private struct MarketStatsWrapper: Codable {
    let stats: [StatItem]
}
