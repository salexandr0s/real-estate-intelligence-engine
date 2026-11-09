import Foundation

@MainActor @Observable
final class ConnectionState {
    private static let apiTokenKey = "apiToken"
    private static let refreshIntervalKey = "refreshInterval"

    private let apiBaseURLOverride: String?
    private let secretStore: any SecretStore

    @ObservationIgnored
    var onRefreshIntervalChange: (@MainActor () -> Void)?

    @ObservationIgnored
    private var didLoadConnectionSecrets = false

    @ObservationIgnored
    private var didLoadConnectionSecretsWithInteraction = false

    @ObservationIgnored
    private var refreshTask: Task<Void, Never>?

    var connectionStatus: ConnectionStatus = .disconnected
    /// What the connection banner says: why the last check of the live connection failed, or which
    /// dependency is down. It stays while a reconnect runs, and Test Connection in Settings leaves it alone.
    var connectionIssue: String?
    var settingsErrorMessage: String?
    private(set) var apiBaseURL: String
    /// Change it through `saveAPIToken`, which saves it.
    private(set) var apiToken: String = ""
    /// True after the Keychain refused to read a token not known yet, until a read or a save
    /// succeeds. Settings says so, and leaves that token alone unless the user types a new one.
    private(set) var isAPITokenUnreadable = false

    /// Stored rather than computed, so views that show it redraw when it changes. Each change is
    /// written to UserDefaults.
    var refreshIntervalSeconds: Int {
        didSet {
            UserDefaults.standard.set(refreshIntervalSeconds, forKey: Self.refreshIntervalKey)
            onRefreshIntervalChange?()
        }
    }

    var hasActiveRefreshTask: Bool {
        refreshTask != nil
    }

    init(secretStore: any SecretStore = KeychainStore.api) {
        self.secretStore = secretStore
        let override = Self.readAPIBaseURLOverride()
        self.apiBaseURLOverride = override
        self.apiBaseURL = override
            ?? UserDefaults.standard.string(forKey: "apiBaseURL")
            ?? APIEndpoint.defaultBaseURL
        self.refreshIntervalSeconds = UserDefaults.standard.integer(forKey: Self.refreshIntervalKey)
            .clamped(to: 10...3600, default: 60)
    }

    func updateAPIBaseURL(_ newValue: String) {
        guard apiBaseURLOverride == nil else { return }
        apiBaseURL = newValue
        UserDefaults.standard.set(newValue, forKey: "apiBaseURL")
    }

    func clearSettingsError() {
        settingsErrorMessage = nil
    }

    func loadConnectionSecretsIfNeeded(allowUserInteraction: Bool) {
        if didLoadConnectionSecrets && (!allowUserInteraction || didLoadConnectionSecretsWithInteraction) {
            return
        }

        switch secretStore.load(key: Self.apiTokenKey, allowUserInteraction: allowUserInteraction) {
        case .value(let token):
            apiToken = token
            isAPITokenUnreadable = false
            didLoadConnectionSecrets = true
            didLoadConnectionSecretsWithInteraction = allowUserInteraction
        case .unreadable(let status):
            // The token in memory stays, and a later call reads again. A token read before still
            // matches the stored one.
            Log.ui.error("Couldn't read the API token from the Keychain (status \(status, privacy: .public))")
            if !didLoadConnectionSecrets {
                isAPITokenUnreadable = true
            }
        }
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

    /// Saves the token and makes it the one in memory. An empty token deletes the stored one.
    @discardableResult
    func saveAPIToken(_ token: String) -> Bool {
        do {
            try secretStore.save(key: Self.apiTokenKey, value: token)
        } catch {
            settingsErrorMessage = "Couldn’t save the API token. \(error.localizedDescription)"
            return false
        }
        settingsErrorMessage = nil
        apiToken = token
        isAPITokenUnreadable = false
        didLoadConnectionSecrets = true
        didLoadConnectionSecretsWithInteraction = true
        return true
    }

    func cleanupStoredSecrets() {
        secretStore.deleteIfEmpty(key: Self.apiTokenKey, allowUserInteraction: true)
    }

    func runSilentStaleSecretsCleanupIfNeeded(versionKey: String) {
        guard !UserDefaults.standard.bool(forKey: versionKey) else { return }
        secretStore.deleteIfEmpty(key: Self.apiTokenKey, allowUserInteraction: false)
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
            userToken: isSmokeTest
                ? nil
                : KeychainStore.api.read(key: apiTokenKey, allowUserInteraction: false).value,
            allowUserInteraction: false
        )
    }

    /// The local engine's API used to listen on 8080. Runs once, so a user who later sets a local
    /// URL on 8080 on purpose keeps it. Remote URLs are left alone.
    static func migrateDefaultPortIfNeeded(defaults: UserDefaults = .standard) {
        let migrationKey = "connection.didMigrateDefaultPort.v1"
        guard !defaults.bool(forKey: migrationKey) else { return }
        defaults.set(true, forKey: migrationKey)

        guard let stored = defaults.string(forKey: "apiBaseURL"),
              LocalRuntimeAuth.isLoopbackBaseURL(stored),
              var components = URLComponents(string: stored),
              components.port == 8080,
              let defaultPort = URLComponents(string: APIEndpoint.defaultBaseURL)?.port else {
            return
        }
        components.port = defaultPort
        if let migrated = components.string {
            defaults.set(migrated, forKey: "apiBaseURL")
        }
    }

    static func initialAPIBaseURL() -> String {
        readAPIBaseURLOverride()
            ?? UserDefaults.standard.string(forKey: "apiBaseURL")
            ?? APIEndpoint.defaultBaseURL
    }

    private static func readAPIBaseURLOverride() -> String? {
        guard let raw = ProcessInfo.processInfo.environment["IMMORADAR_API_BASE_URL_OVERRIDE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !raw.isEmpty else {
            return nil
        }

        return raw
    }
}
