import Foundation

/// The status filter of the alerts list.
enum AlertsScope: String, CaseIterable, Hashable {
    case unread
    case active
    case dismissed
    case failed
    case suppressed
    case all

    var displayName: String {
        switch self {
        case .unread: "Unread"
        case .active: "Active"
        case .dismissed: "Dismissed"
        case .failed: "Failed"
        case .suppressed: "Suppressed"
        case .all: "All"
        }
    }

    /// The `status` values of GET /v1/alerts that make up this scope, one request each. Nil asks
    /// for every status. Unread is the server's `queued` and `sent`.
    var serverStatuses: [AlertServerStatus?] {
        switch self {
        case .unread: [.queued, .sent]
        case .active: [.queued, .sent, .opened]
        case .dismissed: [.dismissed]
        case .failed: [.failed]
        case .suppressed: [.suppressed]
        case .all: [nil]
        }
    }

    func includes(_ status: AlertStatus) -> Bool {
        switch self {
        case .unread: status == .unread
        case .active: status == .unread || status == .opened
        case .dismissed: status == .dismissed
        case .failed: status == .failed
        case .suppressed: status == .suppressed
        case .all: true
        }
    }
}

/// View model for listing alerts with filtering by status and saved filter.
@MainActor @Observable
final class AlertsViewModel {

    // MARK: - State

    var alerts: [Alert] = []
    var isLoading: Bool = false
    /// Why the last load failed. The view hides it while the global connection banner shows.
    var loadErrorMessage: String?
    /// Why the user's last action (read, dismiss, undo) failed.
    var errorMessage: String?
    var selectedAlertID: Int?
    /// Changing the scope loads that status from the server.
    var scope: AlertsScope = .unread {
        didSet { normalizeSelection(preferredID: selectedAlertID) }
    }
    /// Only alerts raised by this saved filter, or nil for every filter.
    var userFilterId: Int? {
        didSet { normalizeSelection(preferredID: selectedAlertID) }
    }
    /// The saved filters the filter bar offers.
    var availableFilters: [Filter] = []
    var sortBy: AlertSortBy = .age {
        didSet { normalizeSelection(preferredID: selectedAlertID) }
    }
    var sortDirection: AlertSortDirection = .desc {
        didSet { normalizeSelection(preferredID: selectedAlertID) }
    }
    var searchText: String = "" {
        didSet { normalizeSelection(preferredID: selectedAlertID) }
    }

    /// Goes up with each load, so an older load that finishes late changes nothing.
    @ObservationIgnored
    private var loadGeneration = 0

    /// Streamed alerts that arrived while a load ran. The load's result may predate them.
    @ObservationIgnored
    private var alertsStreamedDuringLoad: [Alert] = []

    // MARK: - Computed

    /// The loaded alerts still in the current filters. A status change made here can take an
    /// alert out of its scope before the next load.
    var scopedAlerts: [Alert] {
        alerts.filter(matchesFilters)
    }

    var selectedFilterName: String? {
        guard let userFilterId else { return nil }
        return availableFilters.first { $0.id == userFilterId }?.name
    }

    var visibleAlerts: [Alert] {
        var result = scopedAlerts
        if !searchText.isEmpty {
            result = result.filter(matchesSearch)
        }
        return result
    }

    var selectedAlert: Alert? {
        guard let id = selectedAlertID else { return nil }
        return alerts.first { $0.id == id }
    }

    var visibleCount: Int {
        visibleAlerts.count
    }

    var sortDescription: String {
        "\(sortBy.displayName) · \(sortDirection.displayName)"
    }

    private func matchesSearch(_ alert: Alert) -> Bool {
        let query = searchText
        guard !query.isEmpty else { return true }

        let keywords = alert.matchReasons?.matchedKeywords ?? []
        let thresholdTokens = [
            alert.matchReasons?.thresholdsMet?.price == true ? "price" : nil,
            alert.matchReasons?.thresholdsMet?.area == true ? "area" : nil,
            alert.matchReasons?.thresholdsMet?.rooms == true ? "rooms" : nil,
            alert.matchReasons?.thresholdsMet?.score == true ? "score" : nil,
            alert.matchReasons?.districtMatch == true ? "district" : nil,
        ].compactMap { $0 }

        let haystack = [
            alert.title,
            alert.body,
            alert.filterName,
            alert.listing?.title,
            alert.listing?.districtName,
            alert.listing?.city,
            alert.listing?.sourceCode,
            alert.listing?.sourceDisplayName,
            keywords.joined(separator: " "),
            thresholdTokens.joined(separator: " "),
        ]
            .compactMap { $0 }
            .joined(separator: " ")

        return haystack.localizedStandardContains(query)
    }

    /// Whether an alert belongs in the list under the current status and saved filter.
    func matchesFilters(_ alert: Alert) -> Bool {
        if let userFilterId, alert.userFilterId != userFilterId {
            return false
        }
        return scope.includes(alert.status)
    }

    // MARK: - Actions

    /// Loads every alert in the current scope and saved filter, plus the filters the bar offers.
    func refresh(using client: APIClient) async {
        loadGeneration += 1
        let generation = loadGeneration
        isLoading = true
        loadErrorMessage = nil
        alertsStreamedDuringLoad = []

        async let filterOptions = Self.fetchFilterOptions(using: client)
        do {
            var loaded: [Alert] = []
            for status in scope.serverStatuses {
                var cursor: String? = nil
                repeat {
                    var query = AlertQuery()
                    query.status = status
                    query.userFilterId = userFilterId
                    query.limit = 200
                    query.cursor = cursor
                    query.sortBy = sortBy
                    query.sortDirection = sortDirection

                    let response = try await client.fetchAlertsPaginated(query: query)
                    loaded.append(contentsOf: response.alerts)
                    cursor = response.nextCursor
                } while cursor != nil
            }
            guard generation == loadGeneration else {
                _ = await filterOptions
                return
            }

            // One request per status: drop an alert that moved between two of them during the
            // load, and sort the union, since each request came sorted on its own.
            var seenIDs = Set<Int>()
            var merged = loaded.filter { seenIDs.insert($0.id).inserted }
            if scope.serverStatuses.count > 1 {
                merged = sortAlerts(merged)
            }
            for alert in alertsStreamedDuringLoad where matchesFilters(alert) {
                guard seenIDs.insert(alert.id).inserted else { continue }
                merged = inserting(alert, into: merged)
            }
            alerts = merged
            normalizeSelection(preferredID: selectedAlertID)
        } catch {
            // The last loaded alerts stay.
            if generation == loadGeneration {
                loadErrorMessage = AppErrorPresentation.message(for: error)
            }
        }

        if let options = await filterOptions, generation == loadGeneration {
            availableFilters = options.sorted {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
            // The picked filter was deleted since: show every filter's alerts.
            if let userFilterId, !availableFilters.contains(where: { $0.id == userFilterId }) {
                self.userFilterId = nil
            }
        }
        if generation == loadGeneration {
            alertsStreamedDuringLoad = []
            isLoading = false
        }
    }

    /// The saved filters, or nil when they can't be read. The bar then keeps the last ones.
    private nonisolated static func fetchFilterOptions(using client: APIClient) async -> [Filter]? {
        try? await client.fetchFilters()
    }

    func markAsRead(_ alert: Alert, using client: APIClient) async {
        do {
            try await client.markAlertRead(id: alert.id)
            if let idx = alerts.firstIndex(where: { $0.id == alert.id }) {
                alerts[idx].status = .opened
            }
            normalizeSelection(preferredID: alert.id)
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
        }
    }

    func markVisibleRead(using client: APIClient) async {
        let ids = visibleAlerts
            .filter { $0.status == .unread }
            .map(\.id)

        guard !ids.isEmpty else { return }

        do {
            _ = try await client.bulkUpdateAlerts(ids: ids, action: "opened")
            let changedIDs = Set(ids)
            for i in alerts.indices where changedIDs.contains(alerts[i].id) && alerts[i].status == .unread {
                alerts[i].status = .opened
            }
            normalizeSelection(preferredID: selectedAlertID)
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
        }
    }

    func dismissVisible(using client: APIClient) async {
        let ids = visibleAlerts
            .filter { $0.status != .dismissed }
            .map(\.id)

        guard !ids.isEmpty else { return }

        do {
            _ = try await client.bulkUpdateAlerts(ids: ids, action: "dismissed")
            let changedIDs = Set(ids)
            for i in alerts.indices where changedIDs.contains(alerts[i].id) {
                alerts[i].status = .dismissed
            }
            normalizeSelection(preferredID: selectedAlertID)
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
        }
    }

    /// Takes an alert from the live stream. A listed alert is updated in place. A new one goes in
    /// only when it matches the current status and saved filter, so the list shows it once.
    func insertStreamAlert(_ alert: Alert) {
        if isLoading {
            alertsStreamedDuringLoad.append(alert)
        }
        if let existingIndex = alerts.firstIndex(where: { $0.id == alert.id }) {
            alerts[existingIndex] = alert
        } else if matchesFilters(alert) {
            alerts = inserting(alert, into: alerts)
        }
        normalizeSelection(preferredID: selectedAlertID)
    }

    /// The list with a new alert where the sort puts it. Newest first puts it on top.
    private func inserting(_ alert: Alert, into list: [Alert]) -> [Alert] {
        switch sortBy {
        case .age:
            sortDirection == .desc ? [alert] + list : list + [alert]
        case .district, .price:
            sortAlerts(list + [alert])
        }
    }

    /// Dismisses one alert. Undo sends its earlier status back, then runs `afterUndo`.
    func dismiss(
        _ alert: Alert,
        using client: APIClient,
        undoManager: UndoManager? = nil,
        afterUndo: (@MainActor @Sendable () async -> Void)? = nil
    ) async {
        let previousStatus = alert.status
        do {
            let body = try JSONEncoder().encode(APIAlertUpdateRequest(status: AlertStatus.dismissed.serverValue))
            try await client.requestVoid(.updateAlert(id: alert.id, body: body))
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
            return
        }

        if let idx = alerts.firstIndex(where: { $0.id == alert.id }) {
            alerts[idx].status = .dismissed
        }
        normalizeSelection(preferredID: alert.id)
        undoManager?.registerUndo(withTarget: self) { vm in
            Task { @MainActor in
                await vm.restoreStatus(previousStatus, of: alert, using: client)
                await afterUndo?()
            }
        }
        undoManager?.setActionName("Dismiss Alert")
    }

    /// Undo of a status change: sends the earlier status back, unread as `sent`. On failure the
    /// alert keeps its current status and the error shows.
    func restoreStatus(_ status: AlertStatus, of alert: Alert, using client: APIClient) async {
        do {
            let body = try JSONEncoder().encode(APIAlertUpdateRequest(status: status.serverValue))
            try await client.requestVoid(.updateAlert(id: alert.id, body: body))
        } catch {
            errorMessage = AppErrorPresentation.message(for: error)
            return
        }

        if let idx = alerts.firstIndex(where: { $0.id == alert.id }) {
            alerts[idx].status = status
        } else {
            // A reload since the dismiss left it out of this status.
            var restored = alert
            restored.status = status
            if matchesFilters(restored) {
                alerts = sortAlerts(alerts + [restored])
            }
        }
        normalizeSelection(preferredID: alert.id)
    }

    func clearError() {
        errorMessage = nil
    }

    func clearLoadError() {
        loadErrorMessage = nil
    }

    func toggleSortDirection() {
        sortDirection = sortDirection == .desc ? .asc : .desc
    }

    // MARK: - Sorting

    private func sortAlerts(_ input: [Alert]) -> [Alert] {
        input.sorted(by: compareAlerts)
    }

    private func compareAlerts(_ lhs: Alert, _ rhs: Alert) -> Bool {
        switch sortBy {
        case .age:
            if lhs.matchedAtSortDate != rhs.matchedAtSortDate {
                return sortDirection == .asc
                    ? lhs.matchedAtSortDate < rhs.matchedAtSortDate
                    : lhs.matchedAtSortDate > rhs.matchedAtSortDate
            }
        case .district:
            let lhsDistrict = districtSortKey(for: lhs)
            let rhsDistrict = districtSortKey(for: rhs)
            if lhsDistrict != rhsDistrict {
                return sortDirection == .asc ? lhsDistrict < rhsDistrict : lhsDistrict > rhsDistrict
            }
        case .price:
            let lhsPrice = priceSortKey(for: lhs)
            let rhsPrice = priceSortKey(for: rhs)
            if lhsPrice != rhsPrice {
                return sortDirection == .asc ? lhsPrice < rhsPrice : lhsPrice > rhsPrice
            }
        }

        return sortDirection == .asc ? lhs.id < rhs.id : lhs.id > rhs.id
    }

    private func districtSortKey(for alert: Alert) -> String {
        if let location = alert.listing?.alertLocationLabel, !location.isEmpty {
            return location.localizedLowercase
        }
        return sortDirection == .asc ? "~~~~" : ""
    }

    private func priceSortKey(for alert: Alert) -> Int {
        if let price = alert.listing?.listPriceEur {
            return price
        }
        return sortDirection == .asc ? Int.max : -1
    }

    private func normalizeSelection(preferredID: Int?) {
        let visibleIDs = Set(visibleAlerts.map(\.id))

        if let preferredID, visibleIDs.contains(preferredID) {
            selectedAlertID = preferredID
            return
        }

        if let selectedAlertID, visibleIDs.contains(selectedAlertID) {
            return
        }

        selectedAlertID = visibleAlerts.first?.id
    }
}
