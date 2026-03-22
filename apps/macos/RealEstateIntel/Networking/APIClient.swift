import Foundation

/// Actor-based API client for communicating with the Real Estate Intel backend.
/// Thread-safe by design. Handles auth, request building, and response parsing.
actor APIClient {

    // MARK: - Configuration

    private var baseURL: String
    private var authToken: String?
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(
        baseURL: String = "http://localhost:8080",
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

        self.encoder = JSONEncoder()
        self.encoder.keyEncodingStrategy = .convertToSnakeCase
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
        NSLog("[APIClient] %@ %@", urlRequest.httpMethod ?? "?", urlRequest.url?.absoluteString ?? "?")
        let (data, response) = try await performRequest(urlRequest)
        NSLog("[APIClient] Response: %d bytes, status %d", data.count, (response as? HTTPURLResponse)?.statusCode ?? -1)
        try validateResponse(response, data: data)
        do {
            return try decoder.decode(PaginatedResponse<T>.self, from: data)
        } catch {
            let preview = String(data: data.prefix(800), encoding: .utf8) ?? "<binary>"
            let msg = """
            [APIClient] Decode FAILED for \(T.self)
            Error: \(error)
            Response (\(data.count) bytes): \(preview)
            """
            try? msg.write(toFile: "/tmp/rei-decode-error.txt", atomically: true, encoding: .utf8)
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
                baselineDate: dto.baselineDate.flatMap { ISO8601DateFormatter.shared.date(from: $0) } ?? .now
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
                observedAt: ISO8601DateFormatter.shared.date(from: dto.observedAt) ?? .now
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

    /// Save a listing to the watchlist.
    func saveListing(listingId: Int) async throws {
        let body = try encoder.encode(["listingId": listingId])
        try await requestVoid(.saveListing(body: body))
    }

    /// Remove a listing from the watchlist.
    func unsaveListing(listingId: Int) async throws {
        try await requestVoid(.unsaveListing(listingId: listingId))
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

    func updateFilter(id: Int, isActive: Bool) async throws {
        let body = try encoder.encode(["isActive": isActive])
        try await requestVoid(.updateFilter(id: id, body: body))
    }

    func deleteFilter(id: Int) async throws {
        try await requestVoid(.deleteFilter(id: id))
    }

    func createFilterFromDraft(_ apiRequest: APICreateFilterRequest) async throws -> Filter {
        return try await createFilter(apiRequest)
    }

    func updateFilterFull(id: Int, apiRequest: APICreateFilterRequest) async throws -> Filter {
        let body = try encoder.encode(apiRequest)
        let response: APIResponse<APIFilterResponse> = try await request(.updateFilter(id: id, body: body))
        return mapFilterResponse(response.data)
    }

    func fetchAlerts(query: AlertQuery? = nil) async throws -> [Alert] {
        let response: PaginatedResponse<APIAlertResponse> = try await requestPaginated(
            .listAlerts(query: query)
        )
        return response.data.map { dto in
            Alert(
                id: dto.id,
                alertType: AlertType(rawValue: dto.alertType) ?? .newMatch,
                status: AlertStatus(rawValue: dto.status) ?? .unread,
                title: dto.title,
                body: dto.body,
                matchedAt: ISO8601DateFormatter.shared.date(from: dto.matchedAt) ?? .now,
                filterName: dto.filterName,
                listingId: dto.listingId
            )
        }
    }

    /// Bulk update alert statuses. Returns the number of updated alerts.
    func bulkUpdateAlerts(ids: [Int]? = nil, filterStatus: String? = nil, action: String) async throws -> Int {
        struct BulkBody: Encodable {
            let action: String
            let ids: [Int]?
            let filter: FilterBody?

            struct FilterBody: Encodable {
                let status: String?
            }
        }
        let payload = BulkBody(
            action: action,
            ids: ids,
            filter: filterStatus != nil ? BulkBody.FilterBody(status: filterStatus) : BulkBody.FilterBody(status: nil)
        )
        let body = try encoder.encode(payload)

        struct BulkResponse: Codable, Sendable {
            let updatedCount: Int
        }
        let response: APIResponse<BulkResponse> = try await request(.bulkUpdateAlerts(body: body))
        return response.data.updatedCount
    }

    /// Export listings as CSV data.
    func exportListingsCSV(query: ListingQuery) async throws -> Data {
        return try await requestRawData(.exportListings(query: query))
    }

    /// Submit or update investor feedback for a listing.
    func submitFeedback(listingId: Int, rating: String, notes: String?) async throws -> InvestorFeedback {
        struct FeedbackBody: Encodable {
            let listingId: Int
            let rating: String
            let notes: String?
        }
        let body = try encoder.encode(FeedbackBody(listingId: listingId, rating: rating, notes: notes))
        let response: APIResponse<InvestorFeedback> = try await request(.submitFeedback(body: body))
        return response.data
    }

    /// Fetch investor feedback for a listing. Returns nil if none exists.
    func fetchFeedback(listingId: Int) async throws -> InvestorFeedback? {
        struct NullableResponse: Codable, Sendable {
            let data: InvestorFeedback?
        }
        let urlRequest = try buildRequest(for: .getFeedback(listingId: listingId))
        let (data, response) = try await performRequest(urlRequest)
        try validateResponse(response, data: data)
        let parsed = try decoder.decode(NullableResponse.self, from: data)
        return parsed.data
    }

    /// Remove investor feedback for a listing.
    func deleteFeedback(listingId: Int) async throws {
        try await requestVoid(.deleteFeedback(listingId: listingId))
    }

    func markAlertRead(id: Int) async throws {
        let body = try encoder.encode(APIAlertUpdateRequest(status: "opened"))
        try await requestVoid(.updateAlert(id: id, body: body))
    }

    func fetchUnreadCount() async throws -> Int {
        let response: APIResponse<APIUnreadCountResponse> = try await request(.getUnreadCount)
        return response.data.unreadCount
    }

    func updateSource(id: Int, isActive: Bool) async throws {
        let body = try encoder.encode(["isActive": isActive])
        try await requestVoid(.updateSource(id: id, body: body))
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
                lastSuccessfulRun: dto.lastSuccessfulRun.flatMap { ISO8601DateFormatter.shared.date(from: $0) },
                crawlIntervalMinutes: dto.crawlIntervalMinutes,
                lastErrorSummary: dto.lastErrorSummary,
                totalListingsIngested: dto.totalListingsIngested ?? 0,
                successRatePct: dto.successRatePct ?? 0.0
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
            alertFrequency: AlertFrequency(rawValue: dto.alertFrequency ?? "off") ?? .off,
            createdAt: ISO8601DateFormatter.shared.date(from: dto.createdAt) ?? .now,
            updatedAt: ISO8601DateFormatter.shared.date(from: dto.updatedAt) ?? .now,
            matchCount: dto.matchCount
        )
    }

    // MARK: - Connection Test

    func testConnection() async -> Bool {
        do {
            let _ = try await fetchUnreadCount()
            return true
        } catch {
            return false
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
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body = endpoint.body {
            request.httpBody = body
        }

        return request
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
