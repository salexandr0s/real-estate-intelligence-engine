import Foundation
import os

/// Actor-based API client for communicating with the ImmoRadar backend.
/// Thread-safe by design. Handles auth, request building, and response parsing.
actor APIClient {

    // MARK: - Configuration

    private var baseURL: String
    private var authToken: String?
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(
        baseURL: String = APIEndpoint.defaultBaseURL,
        authToken: String? = nil
    ) {
        self.baseURL = baseURL
        self.authToken = authToken

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()
        self.decoder.keyDecodingStrategy = .convertFromSnakeCase

        // Request bodies keep their camelCase keys: the server's schemas use camelCase.
        self.encoder = JSONEncoder()
    }

    // MARK: - Configuration Updates

    func updateBaseURL(_ url: String) {
        self.baseURL = url
    }

    func updateAuthToken(_ token: String?) {
        self.authToken = token
    }

    // MARK: - Generic Request

    func request<T: Codable>(_ endpoint: APIEndpoint) async throws -> T {
        let urlRequest = try buildRequest(for: endpoint)
        let (data, response) = try await performRequest(urlRequest)
        try validateResponse(response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    func requestPaginated<T: Codable>(_ endpoint: APIEndpoint) async throws -> PaginatedResponse<T> {
        let urlRequest = try buildRequest(for: endpoint)
        Log.api.debug("\(urlRequest.httpMethod ?? "?", privacy: .public) \(urlRequest.url?.absoluteString ?? "?", privacy: .public)")
        let (data, response) = try await performRequest(urlRequest)
        Log.api.debug("Response: \(data.count) bytes, status \((response as? HTTPURLResponse)?.statusCode ?? -1)")
        try validateResponse(response, data: data)
        do {
            return try decoder.decode(PaginatedResponse<T>.self, from: data)
        } catch {
            // The type and the decoding error only: the body holds scraped listing data.
            Log.api.error("Decoding a page of \(String(describing: T.self), privacy: .public) failed: \(error, privacy: .public)")
            throw error
        }
    }

    func requestVoid(_ endpoint: APIEndpoint) async throws {
        let urlRequest = try buildRequest(for: endpoint)
        let (data, response) = try await performRequest(urlRequest)
        try validateResponse(response, data: data)
    }

    func requestRawData(_ endpoint: APIEndpoint) async throws -> Data {
        let urlRequest = try buildRequest(for: endpoint)
        let (data, response) = try await performRequest(urlRequest)
        try validateResponse(response, data: data)
        return data
    }

    // MARK: - Typed Convenience Methods

    func fetchListings(query: ListingQuery = ListingQuery()) async throws -> [Listing] {
        let response: PaginatedResponse<APIListingResponse> = try await requestPaginated(
            .listListings(query: query)
        )
        return response.data.compactMap { $0.toDomain(decoder: decoder) }
    }

    /// Fetch listings with pagination metadata (cursor + data).
    func fetchListingsPaginated(query: ListingQuery = ListingQuery()) async throws -> (listings: [Listing], nextCursor: String?) {
        let response: PaginatedResponse<APIListingResponse> = try await requestPaginated(
            .listListings(query: query)
        )
        let listings = response.data.compactMap { $0.toDomain(decoder: decoder) }
        return (listings, response.meta?.nextCursor)
    }

    /// Test a filter against active listings.
    func testFilter(id: Int) async throws -> [Listing] {
        let response: PaginatedResponse<APIListingResponse> = try await requestPaginated(
            .testFilter(id: id)
        )
        return response.data.compactMap { $0.toDomain(decoder: decoder) }
    }

    /// Fetch market baselines for analytics.
    func fetchBaselines() async throws -> [MarketBaseline] {
        let response: PaginatedResponse<APIBaselineResponse> = try await requestPaginated(
            .getBaselines
        )
        return response.data.map { dto in
            MarketBaseline(
                city: dto.city,
                districtNo: dto.districtNo,
                operationType: dto.operationType,
                propertyType: dto.propertyType,
                areaBucket: dto.areaBucket,
                roomBucket: dto.roomBucket,
                sampleSize: dto.sampleSize,
                medianPpsqmEur: dto.medianPpsqmEur,
                p25PpsqmEur: dto.p25PpsqmEur,
                p75PpsqmEur: dto.p75PpsqmEur,
                stddevPpsqmEur: dto.stddevPpsqmEur,
                baselineDate: dto.baselineDate.flatMap(Date.fromISO)
            )
        }
    }

    /// Fetch district price trends over time.
    func fetchDistrictTrends(districtNo: Int? = nil, operationType: String? = nil, months: Int? = nil) async throws -> [DistrictTrendPoint] {
        let response: PaginatedResponse<DistrictTrendPoint> = try await requestPaginated(
            .getDistrictTrends(districtNo: districtNo, operationType: operationType, months: months)
        )
        return response.data
    }

    /// Fetch market temperature by district.
    func fetchMarketTemperature() async throws -> [MarketTemperaturePoint] {
        let response: PaginatedResponse<MarketTemperaturePoint> = try await requestPaginated(
            .getMarketTemperature
        )
        return response.data
    }

    /// Fetch version history for a listing.
    func fetchListingVersions(id: Int) async throws -> [ListingVersion] {
        let response: PaginatedResponse<APIListingVersionResponse> = try await requestPaginated(
            .getListingHistory(listingId: id)
        )
        return response.data.map { dto in
            ListingVersion(
                id: dto.id,
                versionNo: dto.versionNo,
                versionReason: dto.versionReason,
                listPriceEurCents: dto.listPriceEurCents,
                observedAt: Date.fromISO(dto.observedAt)
            )
        }
    }

    func fetchListing(id: Int) async throws -> Listing {
        let response: APIResponse<APIListingResponse> = try await request(.getListing(id: id))
        guard let listing = response.data.toDomain(decoder: decoder) else {
            throw APIError.decodingError(underlying: NSError(
                domain: "APIClient", code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to convert listing DTO"]
            ))
        }
        return listing
    }

    /// Fetch cross-source cluster for a listing. Returns nil if no cluster exists.
    func fetchListingCluster(listingId: Int) async throws -> ListingCluster {
        let response: APIResponse<ListingCluster> = try await request(.getListingCluster(listingId: listingId))
        return response.data
    }

    /// Saves a listing to the watchlist. Saving it again replaces the note, and a nil or blank
    /// note clears the stored one.
    func saveListing(listingId: Int, notes: String? = nil) async throws {
        struct SaveListingBody: Codable {
            let listingId: Int
            let notes: String?
        }

        let body = try encoder.encode(SaveListingBody(listingId: listingId, notes: Self.nonBlank(notes)))
        try await requestVoid(.saveListing(body: body))
    }

    /// Remove a listing from the watchlist.
    func unsaveListing(listingId: Int) async throws {
        try await requestVoid(.unsaveListing(listingId: listingId))
    }

    /// One page of the watchlist. Pass the returned `nextCursor` to load the next page; it is nil
    /// on the last page.
    func fetchSavedListingsPage(cursor: String?, limit: Int) async throws -> (items: [SavedListingItem], nextCursor: String?) {
        // The server takes a limit of 1 to 200.
        let pageSize = min(max(limit, 1), 200)
        let response: PaginatedResponse<SavedListingItem> = try await requestPaginated(
            .listSavedListings(limit: pageSize, cursor: cursor)
        )
        return (response.data, response.meta?.nextCursor)
    }

    /// Check which listing IDs are saved in the watchlist.
    func checkSavedListings(ids: [Int]) async throws -> Set<Int> {
        struct CheckResponse: Codable, Sendable {
            let savedIds: [Int]
        }
        let response: APIResponse<CheckResponse> = try await request(.checkSavedListings(listingIds: ids))
        return Set(response.data.savedIds)
    }

    /// Fetch recent scrape runs, optionally filtered by source code.
    func fetchScrapeRuns(limit: Int? = 20) async throws -> [ScrapeRun] {
        let response: PaginatedResponse<ScrapeRun> = try await requestPaginated(.listScrapeRuns(limit: limit))
        return response.data
    }

    /// Fetch dashboard summary stats (total active, new today, high score) in one call.
    func fetchDashboardStats() async throws -> DashboardStats {
        let data = try await requestRawData(.getDashboardStats)
        return try decoder.decode(DashboardStats.self, from: data)
    }

    /// Fetch daily new-listing counts for sparkline charts (last 14 days).
    func fetchDashboardVelocity() async throws -> [ListingVelocityPoint] {
        let response: PaginatedResponse<ListingVelocityPoint> = try await requestPaginated(.getDashboardVelocity)
        return response.data
    }

    /// Fetch score distribution histogram buckets.
    func fetchScoreDistribution() async throws -> [ScoreDistributionBucket] {
        let response: PaginatedResponse<ScoreDistributionBucket> = try await requestPaginated(.getScoreDistribution)
        return response.data
    }

    /// Fetch per-district aggregate stats (listing count, avg price, avg score).
    func fetchDistrictComparison() async throws -> [DistrictComparison] {
        let response: PaginatedResponse<DistrictComparison> = try await requestPaginated(.getDistrictComparison)
        return response.data
    }

    func fetchAnalysis(listingId: Int) async throws -> ListingAnalysis {
        let response: APIResponse<ListingAnalysis> = try await request(.getAnalysis(listingId: listingId))
        return response.data
    }

    func fetchDocuments(listingId: Int) async throws -> [ListingDocument] {
        let response: PaginatedResponse<ListingDocument> = try await requestPaginated(.getDocuments(listingId: listingId))
        return response.data
    }

    func fetchMailboxes() async throws -> [MailboxAccount] {
        let response: PaginatedResponse<APIMailboxResponse> = try await requestPaginated(.listMailboxes)
        return response.data.map { $0.toDomain() }
    }

    func syncMailbox(id: Int) async throws {
        try await requestVoid(.syncMailbox(id: id))
    }

    func fetchOutreachThreads(scope: OutreachScope = .open, cursor: String? = nil, limit: Int? = 25) async throws -> (threads: [OutreachThreadSummary], nextCursor: String?) {
        let response: PaginatedResponse<APIOutreachThreadSummaryResponse> = try await requestPaginated(
            .listOutreachThreads(scope: scope, cursor: cursor, limit: limit)
        )
        return (response.data.map { $0.toDomain() }, response.meta?.nextCursor)
    }

    func fetchOutreachThread(id: Int) async throws -> OutreachThread {
        let response: APIResponse<APIOutreachThreadResponse> = try await request(.getOutreachThread(id: id))
        return response.data.toDomain()
    }

    /// A 409 (the thread exists or changed) or 503 (`outreach_enqueue_failed`) arrives as
    /// `APIError.httpError` with the server's message.
    func startOutreach(listingId: Int, input: OutreachStartInput) async throws -> Int {
        // The server rejects an empty contact email, so blank contact fields stay out of the body.
        let normalizedInput = OutreachStartInput(
            subject: input.subject,
            bodyText: input.bodyText,
            contactEmail: Self.nonBlank(input.contactEmail),
            contactName: Self.nonBlank(input.contactName),
            contactCompany: Self.nonBlank(input.contactCompany),
            contactPhone: Self.nonBlank(input.contactPhone)
        )
        let body = try encoder.encode(normalizedInput)
        struct StartResponse: Codable, Sendable { let threadId: Int }
        let response: APIResponse<StartResponse> = try await request(.startOutreach(listingId: listingId, body: body))
        return response.data.threadId
    }

    func updateOutreachThread(id: Int, action: OutreachAction) async throws {
        let body = try encoder.encode(APIOutreachActionRequest(action: action.rawValue))
        try await requestVoid(.updateOutreachThread(id: id, body: body))
    }

    /// Nil or blank `subject` and `bodyText` stay out of the body: the server rejects empty strings.
    func sendOutreachFollowup(id: Int, subject: String? = nil, bodyText: String? = nil) async throws {
        struct FollowupRequest: Codable, Sendable {
            let subject: String?
            let bodyText: String?
        }
        let body = try encoder.encode(
            FollowupRequest(subject: Self.nonBlank(subject), bodyText: Self.nonBlank(bodyText))
        )
        try await requestVoid(.sendOutreachFollowup(id: id, body: body))
    }

    func fetchDocumentFacts(documentId: Int) async throws -> [DocumentFact] {
        let response: PaginatedResponse<DocumentFact> = try await requestPaginated(.getDocumentFacts(documentId: documentId))
        return response.data
    }

    func fetchScoreExplanation(listingId: Int) async throws -> ScoreExplanation {
        let response: APIResponse<ScoreExplanation> = try await request(
            .getScoreExplanation(listingId: listingId)
        )
        return response.data
    }

    func fetchFilters() async throws -> [Filter] {
        let response: PaginatedResponse<APIFilterResponse> = try await requestPaginated(.listFilters)
        return response.data.map { mapFilterResponse($0) }
    }

    func createFilter(_ filter: APICreateFilterRequest) async throws -> Filter {
        let body = try encoder.encode(filter)
        let response: APIResponse<APIFilterResponse> = try await request(.createFilter(body: body))
        return mapFilterResponse(response.data)
    }

    /// Pauses or resumes a filter: PATCH `{"isActive": true}`. The criteria stay as they are.
    func updateFilter(id: Int, isActive: Bool) async throws {
        struct ActiveBody: Encodable { let isActive: Bool }
        let body = try encoder.encode(ActiveBody(isActive: isActive))
        try await requestVoid(.updateFilter(id: id, body: body))
    }

    /// Soft-deletes a filter (204). Deleting it again throws `APIError.notFound`.
    func deleteFilter(id: Int) async throws {
        try await requestVoid(.deleteFilter(id: id))
    }

    func createFilterFromDraft(_ apiRequest: APICreateFilterRequest) async throws -> Filter {
        return try await createFilter(apiRequest)
    }

    /// Saves an edited filter. The body carries criteria fields, so the server replaces the whole
    /// criteria set and clears every criteria field the request leaves nil.
    func updateFilterFull(id: Int, apiRequest: APICreateFilterRequest) async throws -> Filter {
        let body = try encoder.encode(apiRequest)
        let response: APIResponse<APIFilterResponse> = try await request(.updateFilter(id: id, body: body))
        return mapFilterResponse(response.data)
    }

    func fetchAlerts(query: AlertQuery? = nil) async throws -> [Alert] {
        let response: PaginatedResponse<APIAlertResponse> = try await requestPaginated(
            .listAlerts(query: query)
        )
        return response.data.map { $0.toDomain(decoder: decoder) }
    }

    /// Fetch alerts with pagination metadata (cursor + data).
    func fetchAlertsPaginated(query: AlertQuery = AlertQuery()) async throws -> (alerts: [Alert], nextCursor: String?) {
        let response: PaginatedResponse<APIAlertResponse> = try await requestPaginated(
            .listAlerts(query: query)
        )
        let alerts = response.data.map { $0.toDomain(decoder: decoder) }
        return (alerts, response.meta?.nextCursor)
    }

    /// The most alert ids PATCH /v1/alerts/bulk takes in one request.
    static let bulkAlertIdLimit = 500

    /// Sets the status of many alerts and returns how many changed. `action` is `opened` or
    /// `dismissed`. With `ids`, those alerts change, sent in chunks the server accepts. With
    /// `ids` nil, every inbox alert changes, or only those in `filterStatus`.
    func bulkUpdateAlerts(ids: [Int]? = nil, filterStatus: AlertServerStatus? = nil, action: String) async throws -> Int {
        struct BulkBody: Encodable {
            let action: String
            let ids: [Int]?
            let filter: FilterBody?

            struct FilterBody: Encodable {
                let status: String?
            }
        }
        struct BulkResponse: Codable, Sendable {
            let updatedCount: Int
        }

        let payloads: [BulkBody]
        if let ids {
            payloads = stride(from: 0, to: ids.count, by: Self.bulkAlertIdLimit).map { start in
                let chunk = Array(ids[start..<min(start + Self.bulkAlertIdLimit, ids.count)])
                return BulkBody(action: action, ids: chunk, filter: nil)
            }
        } else {
            payloads = [
                BulkBody(action: action, ids: nil, filter: BulkBody.FilterBody(status: filterStatus?.rawValue))
            ]
        }

        var updatedCount = 0
        for payload in payloads {
            let body = try encoder.encode(payload)
            let response: APIResponse<BulkResponse> = try await request(.bulkUpdateAlerts(body: body))
            updatedCount += response.data.updatedCount
        }
        return updatedCount
    }

    /// Export listings as CSV data.
    func exportListingsCSV(query: ListingQuery) async throws -> Data {
        return try await requestRawData(.exportListings(query: query))
    }

    func markAlertRead(id: Int) async throws {
        let body = try encoder.encode(APIAlertUpdateRequest(status: "opened"))
        try await requestVoid(.updateAlert(id: id, body: body))
    }

    func fetchUnreadCount() async throws -> Int {
        let response: APIResponse<APIUnreadCountResponse> = try await request(.getUnreadCount)
        return response.data.unreadCount
    }

    /// Switches a source on or off, or sets its interval (5 to 1440 minutes). Switching on a legally
    /// disabled source fails with 409 `conflict`.
    func updateSource(id: Int, isActive: Bool? = nil, crawlIntervalMinutes: Int? = nil) async throws {
        struct SourceUpdateBody: Encodable {
            let isActive: Bool?
            let crawlIntervalMinutes: Int?
        }
        let body = try encoder.encode(
            SourceUpdateBody(isActive: isActive, crawlIntervalMinutes: crawlIntervalMinutes)
        )
        try await requestVoid(.updateSource(id: id, body: body))
    }

    /// Trigger a manual scrape run for the given source code.
    func triggerScrapeRun(sourceCode: String) async throws {
        let body = try encoder.encode(["sourceCode": sourceCode])
        var request = try buildRequest(for: .createScrapeRun(body: body))
        request.timeoutInterval = 12

        let (data, response) = try await performRequest(request)
        try validateResponse(response, data: data)
    }

    func pauseAllSources() async throws {
        try await requestVoid(.pauseAllSources)
    }

    func resumeAllSources() async throws {
        try await requestVoid(.resumeAllSources)
    }

    func fetchSources() async throws -> [Source] {
        let response: PaginatedResponse<APISourceResponse> = try await requestPaginated(.listSources)
        return response.data.map { dto in
            Source(
                id: dto.id,
                code: dto.code,
                name: dto.name,
                isActive: dto.isActive,
                healthStatus: SourceHealthStatus(rawValue: dto.healthStatus) ?? .unknown,
                legalStatus: dto.legalStatus.flatMap(SourceLegalStatus.init(rawValue:)) ?? .unknown,
                disabledReason: dto.disabledReason,
                lastSuccessfulRun: (dto.lastSuccessfulRun ?? dto.lastSuccessfulRunAt).flatMap(Date.fromISO),
                crawlIntervalMinutes: dto.crawlIntervalMinutes,
                lastErrorSummary: dto.lastErrorSummary,
                totalListingsIngested: dto.totalListingsIngested ?? 0,
                successRatePct: dto.successRatePct ?? 0.0,
                lifecycleSummary: dto.lifecycleSummary.map { summary in
                    Source.LifecycleSummary(
                        explicitDead24h: summary.explicitDead24h,
                        explicitDead7d: summary.explicitDead7d,
                        staleExpired24h: summary.staleExpired24h,
                        staleExpired7d: summary.staleExpired7d,
                        lastExplicitDeadAt: summary.lastExplicitDeadAt.flatMap(Date.fromISO),
                        lastStaleExpiredAt: summary.lastStaleExpiredAt.flatMap(Date.fromISO)
                    )
                }
            )
        }
    }

    // MARK: - DTO Mapping Helpers

    private func mapFilterResponse(_ dto: APIFilterResponse) -> Filter {
        Filter(
            id: dto.id,
            name: dto.name,
            filterKind: FilterKind(rawValue: dto.filterKind) ?? .saved,
            isActive: dto.isActive,
            criteria: FilterCriteria(
                operationType: dto.operationType.flatMap { OperationType(rawValue: $0) },
                propertyTypes: (dto.propertyTypes ?? []).compactMap { PropertyType(rawValue: $0) },
                districts: dto.districts ?? [],
                minPriceEur: dto.minPriceEur,
                maxPriceEur: dto.maxPriceEur,
                minAreaSqm: dto.minAreaSqm,
                maxAreaSqm: dto.maxAreaSqm,
                minRooms: dto.minRooms,
                maxRooms: dto.maxRooms,
                minScore: dto.minScore,
                requiredKeywords: dto.requiredKeywords ?? [],
                excludedKeywords: dto.excludedKeywords ?? [],
                sortBy: dto.sortBy
            ),
            alertFrequency: dto.alertFrequency.flatMap(AlertFrequency.init(rawValue:)) ?? .off,
            createdAt: Date.fromISO(dto.createdAt),
            updatedAt: Date.fromISO(dto.updatedAt),
            matchCount: dto.matchCount
        )
    }

    // MARK: - Connection Test

    func testConnection() async -> Result<Void, Error> {
        do {
            let _ = try await fetchUnreadCount()
            return .success(())
        } catch {
            return .failure(error)
        }
    }

    // MARK: - Private Helpers

    private func buildRequest(for endpoint: APIEndpoint) throws -> URLRequest {
        guard var components = URLComponents(string: baseURL + endpoint.path) else {
            throw APIError.invalidURL
        }

        if let queryItems = endpoint.queryItems, !queryItems.isEmpty {
            components.queryItems = queryItems
        }

        guard let url = components.url else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // Fastify rejects a JSON content type with an empty body, so only a request with a body sets it.
        if let body = endpoint.body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }

        return request
    }

    /// The value trimmed, or nil when nothing is left.
    private static func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func performRequest(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError where error.code == .cannotConnectToHost
            || error.code == .notConnectedToInternet
            || error.code == .networkConnectionLost {
            throw APIError.noConnection
        } catch {
            throw APIError.networkError(underlying: error)
        }
    }

    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError(underlying: NSError(
                domain: "APIClient", code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Invalid response type"]
            ))
        }

        switch httpResponse.statusCode {
        case 200..<300:
            return
        case 401:
            throw APIError.unauthorized
        case 404:
            throw APIError.notFound
        default:
            let detail = try? decoder.decode(APIErrorResponse.self, from: data)
            throw APIError.httpError(statusCode: httpResponse.statusCode, detail: detail?.error)
        }
    }
}
