import Foundation
import os

/// View model for the copilot chat feature.
@MainActor @Observable
final class CopilotViewModel {

    // MARK: - State

    var messages: [CopilotMessage] = []
    var inputText: String = ""
    var isStreaming: Bool = false
    var errorMessage: String?

    // MARK: - Streaming State

    private var streamingText: String = ""
    private var streamingTextBlockId: UUID?
    private var currentBlocks: [ContentBlock] = []
    private var streamTask: Task<Void, Never>?

    // MARK: - Services

    private let streamService = CopilotStreamService()

    // MARK: - Inspector

    var inspectedListing: Listing?
    var isLoadingInspector: Bool = false
    var inspectorError: String?
    private var inspectorTask: Task<Void, Never>?

    // MARK: - Context

    var currentListingId: Int?
    var currentDistrictNo: Int?

    // MARK: - Suggestions

    var suggestions: [SuggestedQuery] {
        guard messages.isEmpty else { return [] }
        return [
            SuggestedQuery(
                label: "Top deals this week",
                query: "Show me the highest scoring listings from this week"
            ),
            SuggestedQuery(
                label: "Under \u{20AC}300k, 50+ sqm",
                query: "Find apartments under 300k with at least 50sqm"
            ),
            SuggestedQuery(
                label: "Price drops today",
                query: "What listings had price drops recently?"
            ),
            SuggestedQuery(
                label: "Compare district 2 vs 10",
                query: "Compare the real estate market in district 2 vs district 10"
            ),
        ]
    }

    // MARK: - Actions

    func send(using appState: AppState) async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming else { return }

        inputText = ""
        errorMessage = nil

        // Add user message
        let userMessage = CopilotMessage(
            role: .user,
            contentBlocks: [ContentBlock(.text(text))]
        )
        messages.append(userMessage)

        // Add assistant placeholder
        let assistantMessage = CopilotMessage(
            role: .assistant,
            contentBlocks: [ContentBlock(.loading("Thinking..."))],
            isStreaming: true
        )
        messages.append(assistantMessage)

        isStreaming = true
        streamingText = ""
        streamingTextBlockId = nil
        currentBlocks = []

        // Build serialized messages for the API
        let serializedMessages = messages.dropLast().map { msg -> [String: Any] in
            let content: String
            if let firstText = msg.contentBlocks.compactMap({ block -> String? in
                if case .text(let t) = block.content { return t }
                return nil
            }).first {
                content = firstText
            } else {
                content = ""
            }
            return ["role": msg.role.rawValue, "content": content]
        }

        var context: [String: Any]?
        if currentListingId != nil || currentDistrictNo != nil {
            var ctx: [String: Any] = [:]
            if let lid = currentListingId { ctx["currentListingId"] = lid }
            if let dno = currentDistrictNo { ctx["currentDistrictNo"] = dno }
            context = ctx
        }

        streamTask = Task {
            var didFinalize = false

            do {
                let stream = streamService.stream(
                    baseURL: appState.apiBaseURL,
                    token: appState.apiToken.isEmpty ? "dev-token" : appState.apiToken,
                    messages: serializedMessages,
                    context: context,
                    provider: appState.copilotProvider.apiProvider,
                    copilotApiKey: appState.activeCopilotApiKey,
                    model: appState.copilotModel.isEmpty ? nil : appState.copilotModel
                )

                for try await event in stream {
                    if Task.isCancelled { break }

                    if case .done = event {
                        finalizeStream()
                        didFinalize = true
                        break
                    }
                    if case .error(let message) = event {
                        errorMessage = message
                        finalizeStream()
                        didFinalize = true
                        break
                    }
                    handleStreamEvent(event)
                }
            } catch is CancellationError {
                // User cancelled — expected
            } catch {
                errorMessage = error.localizedDescription
                Log.stream.error("Copilot stream error: \(error, privacy: .public)")
            }

            if !didFinalize {
                finalizeStream()
            }
        }
    }

    func stop() {
        streamTask?.cancel()
        streamTask = nil
        finalizeStream()
    }

    func clearConversation() {
        messages = []
        inputText = ""
        isStreaming = false
        errorMessage = nil
        streamingText = ""
        streamingTextBlockId = nil
        currentBlocks = []
        streamTask?.cancel()
        streamTask = nil
        inspectorTask?.cancel()
        inspectorTask = nil
        inspectedListing = nil
        inspectorError = nil
        isLoadingInspector = false
    }

    func selectListing(id: Int, using appState: AppState) {
        inspectorTask?.cancel()
        inspectorError = nil
        isLoadingInspector = true

        inspectorTask = Task {
            do {
                let listing = try await appState.apiClient.fetchListing(id: id)
                guard !Task.isCancelled else { return }
                inspectedListing = listing
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                Log.ui.error("Failed to load listing \(id): \(error, privacy: .public)")
                inspectorError = "Could not load listing details."
                inspectedListing = nil
            }
            isLoadingInspector = false
        }
    }

    // MARK: - Stream Event Handling

    private func handleStreamEvent(_ event: CopilotStreamEvent) {
        guard !messages.isEmpty else { return }
        let lastIndex = messages.count - 1

        switch event {
        case .textDelta(let delta):
            streamingText += delta
            updateAssistantMessage(at: lastIndex)

        case .toolUse(let name):
            let label = Self.toolDisplayName(name)
            if let loadingIdx = messages[lastIndex].contentBlocks.firstIndex(where: {
                if case .loading = $0.content { return true }
                return false
            }) {
                messages[lastIndex].contentBlocks[loadingIdx] = ContentBlock(.loading(label))
            }

        case .contentBlock(let block):
            currentBlocks.append(block)
            updateAssistantMessage(at: lastIndex)

        case .done, .error:
            break // handled in send() loop
        }
    }

    private func updateAssistantMessage(at index: Int) {
        var blocks: [ContentBlock] = []

        if !streamingText.isEmpty {
            // Reuse the same block ID for the streaming text to avoid SwiftUI churn
            let textBlock: ContentBlock
            if let existingId = streamingTextBlockId {
                textBlock = ContentBlock(id: existingId, content: .text(streamingText))
            } else {
                textBlock = ContentBlock(.text(streamingText))
                streamingTextBlockId = textBlock.id
            }
            blocks.append(textBlock)
        }

        blocks.append(contentsOf: currentBlocks)

        if blocks.isEmpty {
            blocks.append(ContentBlock(.loading("Thinking...")))
        }

        messages[index].contentBlocks = blocks
        messages[index].isStreaming = true
    }

    private func finalizeStream() {
        guard isStreaming else { return }
        isStreaming = false
        streamTask = nil

        guard !messages.isEmpty else { return }
        let lastIndex = messages.count - 1

        messages[lastIndex].contentBlocks.removeAll { block in
            if case .loading = block.content { return true }
            return false
        }
        messages[lastIndex].isStreaming = false

        if messages[lastIndex].contentBlocks.isEmpty {
            if let error = errorMessage {
                messages[lastIndex].contentBlocks = [ContentBlock(.text("Error: \(error)"))]
            } else {
                messages[lastIndex].contentBlocks = [ContentBlock(.text("No response received."))]
            }
        }
    }

    // MARK: - Helpers

    private static func toolDisplayName(_ name: String) -> String {
        switch name {
        case "search_listings":
            return "Searching listings..."
        case "get_listing_detail":
            return "Loading listing details..."
        case "get_score_explanation":
            return "Analyzing score..."
        case "compare_listings":
            return "Comparing listings..."
        case "get_price_history":
            return "Loading price history..."
        case "get_market_stats":
            return "Fetching market data..."
        case "get_nearby_pois":
            return "Checking nearby amenities..."
        case "get_cross_source_cluster":
            return "Finding cross-source matches..."
        default:
            return "Working..."
        }
    }
}
