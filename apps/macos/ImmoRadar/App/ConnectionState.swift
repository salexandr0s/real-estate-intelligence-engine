import Foundation

@MainActor @Observable
final class ConnectionState {
    private let apiBaseURLOverride: String?

    @ObservationIgnored
    var onRefreshIntervalChange: (@MainActor () -> Void)?

    @ObservationIgnored
    private var didLoadConnectionSecrets = false

    @ObservationIgnored
    private var didLoadConnectionSecretsWithInteraction = false

    @ObservationIgnored
    private var refreshTask: Task<Void, Never>?

    var connectionStatus: ConnectionStatus = .disconnected
    var settingsErrorMessage: String?
    private(set) var apiBaseURL: String
    private(set) var apiToken: String = ""

    var refreshIntervalSeconds: Int {
        get { UserDefaults.standard.integer(forKey: "refreshInterval").clamped(to: 10...3600, default: 60) }
        set {
            UserDefaults.standard.set(newValue, forKey: "refreshInterval")
            onRefreshIntervalChange?()
        }
    }

    var hasActiveRefreshTask: Bool {
        refreshTask != nil
    }

    init() {
        let override = Self.readAPIBaseURLOverride()
        self.apiBaseURLOverride = override
        self.apiBaseURL = override
            ?? UserDefaults.standard.string(forKey: "apiBaseURL")
            ?? "http://localhost:8080"
    }

    func updateAPIBaseURL(_ newValue: String) {
        guard apiBaseURLOverride == nil else { return }
        apiBaseURL = newValue
        UserDefaults.standard.set(newValue, forKey: "apiBaseURL")
    }

    func updateAPIToken(_ newValue: String) {
        apiToken = newValue
    }

    func markSecretsLoaded(withUserInteraction allowUserInteraction: Bool) {
        didLoadConnectionSecrets = true
        didLoadConnectionSecretsWithInteraction = allowUserInteraction
    }

    func clearSettingsError() {
        settingsErrorMessage = nil
    }

    func loadConnectionSecretsIfNeeded(allowUserInteraction: Bool) {
        if didLoadConnectionSecrets && (!allowUserInteraction || didLoadConnectionSecretsWithInteraction) {
            return
        }

        apiToken = KeychainHelper.get(
            key: "apiToken",
            allowUserInteraction: allowUserInteraction
        ) ?? ""
        if allowUserInteraction, apiToken.isEmpty {
            _ = KeychainHelper.delete(key: "apiToken")
        }
        didLoadConnectionSecrets = true
        didLoadConnectionSecretsWithInteraction = allowUserInteraction
    }

    func loadConnectionSecretForUserAction() {
        loadConnectionSecretsIfNeeded(allowUserInteraction: true)
    }

    func resolvedConnectionAuthToken(allowUserInteraction: Bool = true) -> String? {
        LocalRuntimeAuth.preferredToken(
            for: apiBaseURL,
            userToken: apiToken,
            allowUserInteraction: allowUserInteraction
        )
    }

    func resolvedConnectionAuthToken(
        for baseURL: String,
        userToken: String,
        allowUserInteraction: Bool
    ) -> String? {
        LocalRuntimeAuth.preferredToken(
            for: baseURL,
            userToken: userToken,
            allowUserInteraction: allowUserInteraction
        )
    }

    func testConnection(baseURL: String, token: String) async {
        let normalizedBaseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalizedBaseURL.isEmpty else {
            settingsErrorMessage = "Base URL is required."
            connectionStatus = .disconnected
            return
        }

        settingsErrorMessage = nil
        connectionStatus = .connecting

        let client = APIClient(
            baseURL: normalizedBaseURL,
            authToken: LocalRuntimeAuth.preferredToken(
                for: normalizedBaseURL,
                userToken: normalizedToken,
                allowUserInteraction: true
            )
        )

        switch await client.testConnection() {
        case .success:
            connectionStatus = .connected
        case .failure(let error):
            connectionStatus = .error(AppErrorPresentation.message(for: error))
        }
    }

    @discardableResult
    func persistAPIToken(_ token: String) -> Bool {
        do {
            if token.isEmpty {
                _ = KeychainHelper.delete(key: "apiToken")
            } else {
                try KeychainHelper.set(key: "apiToken", value: token)
            }
            settingsErrorMessage = nil
            return true
        } catch {
            settingsErrorMessage = "Couldn’t save API token. \(error.localizedDescription)"
            return false
        }
    }

    func cleanupStoredSecrets() {
        cleanupIfEmpty(key: "apiToken", allowUserInteraction: true)
    }

    func runSilentStaleSecretsCleanupIfNeeded(versionKey: String) {
        guard !UserDefaults.standard.bool(forKey: versionKey) else { return }
        cleanupIfEmpty(key: "apiToken", allowUserInteraction: false)
        UserDefaults.standard.set(true, forKey: versionKey)
    }

    func startRefreshTaskIfNeeded(
        allowsBackgroundRefreshTasks: Bool,
        action: @escaping @MainActor () async -> Void
    ) {
        stopRefreshTask()
        guard allowsBackgroundRefreshTasks else { return }

        let intervalSeconds = refreshIntervalSeconds
        refreshTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(intervalSeconds))
                guard !Task.isCancelled else { break }
                await action()
            }
        }
    }

    func stopRefreshTask() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    static func initialStoredAuthToken(isSmokeTest: Bool) -> String? {
        LocalRuntimeAuth.preferredToken(
            for: initialAPIBaseURL(),
            userToken: isSmokeTest ? nil : KeychainHelper.get(key: "apiToken", allowUserInteraction: false),
            allowUserInteraction: false
        )
    }

    static func initialAPIBaseURL() -> String {
        readAPIBaseURLOverride()
            ?? UserDefaults.standard.string(forKey: "apiBaseURL")
            ?? "http://localhost:8080"
    }

    private static func readAPIBaseURLOverride() -> String? {
        guard let raw = ProcessInfo.processInfo.environment["IMMORADAR_API_BASE_URL_OVERRIDE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !raw.isEmpty else {
            return nil
        }

        return raw
    }

    private func cleanupIfEmpty(key: String, allowUserInteraction: Bool) {
        guard let value = KeychainHelper.get(
            key: key,
            allowUserInteraction: allowUserInteraction
        ) else {
            return
        }

        guard value.isEmpty else { return }
        _ = KeychainHelper.delete(key: key)
    }
}
