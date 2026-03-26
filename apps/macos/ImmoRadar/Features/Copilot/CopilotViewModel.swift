import Foundation
import os

/// View model for the copilot research workspace.
@MainActor @Observable
final class CopilotViewModel {

    // MARK: - State

    var messages: [CopilotMessage] = []
    var inputText: String = ""
    var isStreaming: Bool = false
    var errorMessage: String?

    // MARK: - Conversation History

    var conversations: [CopilotConversationSummary] = []
    var activeConversationID: UUID?
    var activeConversationTitle: String?
    private var activeConversationCreatedAt: Date?
    private var hasLoadedPersistedState = false

    // MARK: - Streaming State

    private var streamingText: String = ""
    private var streamingTextBlockId: UUID?
    private var currentBlocks: [ContentBlock] = []
    private var streamTask: Task<Void, Never>?

    // MARK: - Services

    private let streamService = CopilotStreamService()
    private let conversationStore = CopilotConversationStore()

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
                label: "Morning brief",
                query: "Summarize the most interesting listings and score changes from this week",
                subtitle: "Get the fastest overview of what deserves attention right now.",
                icon: "sun.max"
            ),
            SuggestedQuery(
                label: "Targeted search",
                query: "Find apartments under 300k with at least 50sqm and strong scores",
                subtitle: "Use explicit investment criteria instead of open-ended chat.",
                icon: "line.3.horizontal.decrease.circle"
            ),
            SuggestedQuery(
                label: "District comparison",
                query: "Compare the real estate market in district 2 vs district 10",
                subtitle: "Turn market questions into structured side-by-side analysis.",
                icon: "square.split.2x1"
            ),
            SuggestedQuery(
                label: "Recent price drops",
                query: "Show me listings with recent price drops and explain which are worth a closer look",
                subtitle: "Surface changes worth acting on, not just raw events.",
                icon: "arrow.down.circle"
            ),
        ]
    }

    // MARK: - Lifecycle

    func loadSavedStateIfNeeded() async {
        guard !hasLoadedPersistedState else { return }
        hasLoadedPersistedState = true

        let storedConversations = await conversationStore.loadAll()
        conversations = storedConversations.map(\.summary)

        if let latest = storedConversations.first {
            activateConversation(latest)
        }
    }

    // MARK: - Conversation Actions

    func beginNewConversation() {
        resetEphemeralState()
        activeConversationID = nil
        activeConversationTitle = nil
        activeConversationCreatedAt = nil
        messages = []
        inputText = ""
        errorMessage = nil
    }

    func clearConversation() {
        beginNewConversation()
    }

    func selectConversation(id: UUID) async {
        guard activeConversationID != id else { return }
        guard let conversation = await conversationStore.loadConversation(id: id) else { return }
        activateConversation(conversation)
    }

    func renameActiveConversation(to newTitle: String) async {
        let trimmed = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let id = activeConversationID, !trimmed.isEmpty else { return }
        activeConversationTitle = trimmed
        await persistCurrentConversation(forceTitle: trimmed)
        await refreshConversationSummaries(selecting: id)
    }

    func deleteConversation(id: UUID) async {
        await conversationStore.deleteConversation(id: id)

        let storedConversations = await conversationStore.loadAll()
        conversations = storedConversations.map(\.summary)

        if activeConversationID == id {
            if let latest = storedConversations.first {
                activateConversation(latest)
            } else {
                beginNewConversation()
            }
        }
    }

    // MARK: - Chat Actions

    func send(using appState: AppState) async {
        await loadSavedStateIfNeeded()

        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming else { return }

        if activeConversationID == nil {
            activeConversationID = UUID()
            activeConversationCreatedAt = .now
            activeConversationTitle = Self.defaultConversationTitle(from: text)
        }

        inputText = ""
        errorMessage = nil

        let userMessage = CopilotMessage(
            role: .user,
            contentBlocks: [ContentBlock(.text(text))]
        )
        messages.append(userMessage)
        await persistCurrentConversation()
        if let id = activeConversationID {
            await refreshConversationSummaries(selecting: id)
        }

        let assistantMessage = CopilotMessage(
            role: .assistant,
            contentBlocks: [ContentBlock(.loading("Working through your request…"))],
            isStreaming: true
        )
        messages.append(assistantMessage)

        isStreaming = true
        streamingText = ""
        streamingTextBlockId = nil
        currentBlocks = []

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
                        let lower = message.lowercased()
                        if lower.contains("oauth token") || lower.contains("token rejected") {
                            let refreshed = await Task.detached(priority: .userInitiated) {
                                ClaudeAuthHelper.forceRefresh() != nil
                            }.value
                            if refreshed {
                                Log.stream.info("OAuth token force-refreshed after rejection, user should retry")
                                errorMessage = "OAuth token was stale — refreshed automatically. Please try again."
                            } else {
                                errorMessage = message
                            }
                        } else {
                            errorMessage = message
                        }
                        finalizeStream()
                        didFinalize = true
                        break
                    }
                    handleStreamEvent(event)
                }
            } catch is CancellationError {
                // Expected when user starts a new chat or switches conversations.
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
            break
        }
    }

    private func updateAssistantMessage(at index: Int) {
        var blocks: [ContentBlock] = []

        if !streamingText.isEmpty {
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
            blocks.append(ContentBlock(.loading("Working through your request…")))
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

        Task {
            await persistCurrentConversation()
            if let id = activeConversationID {
                await refreshConversationSummaries(selecting: id)
            }
        }
    }

    // MARK: - Persistence

    private func activateConversation(_ conversation: CopilotConversation) {
        resetEphemeralState()
        activeConversationID = conversation.id
        activeConversationTitle = conversation.title
        activeConversationCreatedAt = conversation.createdAt
        messages = conversation.messages
        inputText = ""
        errorMessage = nil
    }

    private func persistCurrentConversation(forceTitle: String? = nil) async {
        guard let conversation = makeConversationSnapshot(forceTitle: forceTitle) else { return }
        await conversationStore.upsertConversation(conversation)
    }

    private func refreshConversationSummaries(selecting selectedID: UUID?) async {
        let storedConversations = await conversationStore.loadAll()
        conversations = storedConversations.map(\.summary)

        if let selectedID,
           let selected = storedConversations.first(where: { $0.id == selectedID }) {
            activeConversationTitle = selected.title
            activeConversationCreatedAt = selected.createdAt
        }
    }

    private func makeConversationSnapshot(forceTitle: String? = nil) -> CopilotConversation? {
        guard let id = activeConversationID else { return nil }

        let cleanedMessages = sanitize(messages)
        guard !cleanedMessages.isEmpty else { return nil }

        let title = (forceTitle ?? activeConversationTitle ?? Self.defaultConversationTitle(from: cleanedMessages))
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return CopilotConversation(
            id: id,
            title: title.isEmpty ? "Untitled conversation" : title,
            createdAt: activeConversationCreatedAt ?? cleanedMessages.first?.timestamp ?? .now,
            updatedAt: .now,
            messages: cleanedMessages
        )
    }

    private func sanitize(_ sourceMessages: [CopilotMessage]) -> [CopilotMessage] {
        sourceMessages.compactMap { message in
            let blocks = message.contentBlocks.filter { block in
                if case .loading = block.content { return false }
                return true
            }

            guard !blocks.isEmpty else { return nil }
            return CopilotMessage(
                id: message.id,
                role: message.role,
                contentBlocks: blocks,
                timestamp: message.timestamp,
                isStreaming: false
            )
        }
    }

    private func resetEphemeralState() {
        streamTask?.cancel()
        streamTask = nil
        inspectorTask?.cancel()
        inspectorTask = nil
        inspectedListing = nil
        inspectorError = nil
        isLoadingInspector = false
        isStreaming = false
        streamingText = ""
        streamingTextBlockId = nil
        currentBlocks = []
    }

    // MARK: - Helpers

    private static func defaultConversationTitle(from prompt: String) -> String {
        let singleLine = prompt
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(singleLine.prefix(48)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func defaultConversationTitle(from messages: [CopilotMessage]) -> String {
        let firstUserText = messages.first(where: { $0.role == .user })?.contentBlocks.compactMap { block -> String? in
            if case .text(let value) = block.content { return value }
            return nil
        }.first

        return defaultConversationTitle(from: firstUserText ?? "Untitled conversation")
    }

    private static func toolDisplayName(_ name: String) -> String {
        switch name {
        case "search_listings":
            return "Searching listings…"
        case "get_listing_detail":
            return "Loading listing details…"
        case "get_score_explanation":
            return "Analyzing score…"
        case "compare_listings":
            return "Comparing listings…"
        case "get_price_history":
            return "Loading price history…"
        case "get_market_stats":
            return "Fetching market data…"
        case "get_nearby_pois":
            return "Checking nearby amenities…"
        case "get_cross_source_cluster":
            return "Finding cross-source matches…"
        default:
            return "Working…"
        }
    }
}

// MARK: - Conversation Store

actor CopilotConversationStore {
    private let fileManager = FileManager.default

    private var storeURL: URL {
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let directory = appSupport
            .appendingPathComponent("ImmoRadar", isDirectory: true)
            .appendingPathComponent("Copilot", isDirectory: true)
        if !fileManager.fileExists(atPath: directory.path) {
            try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        return directory.appendingPathComponent("conversations.json")
    }

    func loadAll() -> [CopilotConversation] {
        guard let data = try? Data(contentsOf: storeURL) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        guard let conversations = try? decoder.decode([CopilotConversation].self, from: data) else {
            Log.stream.error("Failed to decode persisted copilot conversations")
            return []
        }

        return conversations.sorted { $0.updatedAt > $1.updatedAt }
    }

    func loadConversation(id: UUID) -> CopilotConversation? {
        loadAll().first(where: { $0.id == id })
    }

    func upsertConversation(_ conversation: CopilotConversation) {
        var conversations = loadAll().filter { $0.id != conversation.id }
        conversations.append(conversation)
        saveAll(conversations.sorted { $0.updatedAt > $1.updatedAt })
    }

    func deleteConversation(id: UUID) {
        let filtered = loadAll().filter { $0.id != id }
        saveAll(filtered)
    }

    private func saveAll(_ conversations: [CopilotConversation]) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601

        do {
            let data = try encoder.encode(conversations)
            try data.write(to: storeURL, options: .atomic)
        } catch {
            Log.stream.error("Failed to persist copilot conversations: \(error, privacy: .public)")
        }
    }
}
