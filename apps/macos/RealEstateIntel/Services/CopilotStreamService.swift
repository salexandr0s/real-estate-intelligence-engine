import Foundation
import os

// MARK: - Stream Service

/// SSE client for copilot chat streaming responses.
/// Unlike AlertStreamService (long-lived GET), this is request-response via POST.
final class CopilotStreamService: Sendable {

    func stream(
        baseURL: String,
        token: String,
        messages: [[String: Any]],
        context: [String: Any]? = nil,
        provider: String,
        copilotApiKey: String,
        model: String? = nil
    ) -> AsyncThrowingStream<CopilotStreamEvent, Error> {
        // Serialize body outside the async closure to avoid Sendable issues with [String: Any]
        var body: [String: Any] = ["messages": messages]
        if let context {
            body["context"] = context
        }
        body["provider"] = provider
        if let model, !model.isEmpty { body["model"] = model }
        let bodyData: Data
        do {
            bodyData = try JSONSerialization.data(withJSONObject: body)
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

                    guard http.statusCode == 200 else {
                        continuation.yield(.error("Server returned status \(http.statusCode)"))
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

    // MARK: - Event Parsing

    private static func parseEvent(type: String, data: String) -> CopilotStreamEvent? {
        switch type {
        case "text_delta":
            guard let json = parseJSON(data),
                  let delta = json["delta"] as? String else {
                return nil
            }
            return .textDelta(delta)

        case "tool_use":
            guard let json = parseJSON(data),
                  let name = json["toolName"] as? String ?? json["tool_name"] as? String else {
                return nil
            }
            return .toolUse(name: name)

        case "content_block":
            return parseContentBlock(data: data)

        case "done":
            return .done

        case "error":
            if let json = parseJSON(data),
               let message = json["message"] as? String {
                return .error(message)
            }
            return .error("Unknown error")

        default:
            Log.stream.debug("Unknown copilot event type: \(type, privacy: .public)")
            return nil
        }
    }

    // MARK: - Content Block Parsing

    private static func parseContentBlock(data: String) -> CopilotStreamEvent? {
        guard let jsonData = data.data(using: .utf8),
              let json = parseJSON(data),
              let blockType = json["type"] as? String else {
            return nil
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601

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

            default:
                Log.stream.debug("Unknown content block type: \(blockType, privacy: .public)")
                return nil
            }
        } catch {
            Log.stream.error("Failed to decode content block '\(blockType, privacy: .public)': \(error, privacy: .public)")
            return nil
        }
    }

    private static func parseJSON(_ string: String) -> [String: Any]? {
        guard let data = string.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
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
