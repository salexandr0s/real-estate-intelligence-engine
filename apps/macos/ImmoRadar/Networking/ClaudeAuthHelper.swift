import Foundation
import os

/// Reads and refreshes OAuth credentials from Claude Code's storage.
/// Supports both the legacy JSON file (~/.claude/.credentials.json) and
/// the newer macOS Keychain entry ("Claude Code-credentials").
enum ClaudeAuthHelper {

    private static let credPath: URL = {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/.credentials.json")
    }()

    /// Claude Code's OAuth client ID (used for token refresh).
    private static let oauthClientId = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
    private static let tokenEndpoint = "https://console.anthropic.com/v1/oauth/token"
    private static let keychainService = "Claude Code-credentials"

    // MARK: - Public API

    /// Reads the OAuth access token, refreshing if expired or close to expiry.
    static func loadOAuthToken() -> String? {
        guard let creds = readCredentials() else { return nil }

        // Refresh if expired OR within 5 minutes of expiry.
        let needsRefresh: Bool
        if let expiresAt = creds.expiresAt {
            let expiryDate = Date(timeIntervalSince1970: expiresAt / 1000.0)
            let buffer: TimeInterval = 5 * 60 // 5 minutes
            needsRefresh = expiryDate.timeIntervalSinceNow < buffer
        } else {
            needsRefresh = true
        }

        if needsRefresh {
            Log.stream.info("Claude OAuth token expired or near expiry, refreshing...")
            if let refreshed = refreshTokenSync(refreshToken: creds.refreshToken) {
                return refreshed
            }
            Log.stream.warning("Token refresh failed, using existing token")
        }

        return creds.accessToken
    }

    /// Force-refresh the token. Call this when the API rejects a seemingly-valid token.
    static func forceRefresh() -> String? {
        guard let creds = readCredentials() else { return nil }
        Log.stream.info("Force-refreshing Claude OAuth token...")
        return refreshTokenSync(refreshToken: creds.refreshToken)
    }

    /// Check if a Claude subscription is available.
    static var isAvailable: Bool {
        readCredentials() != nil
    }

    /// Returns the subscription type if available (e.g., "max", "pro").
    static var subscriptionType: String? {
        readCredentials()?.subscriptionType
    }

    /// Loads availability and plan metadata in a single keychain/file read.
    static func loadSubscriptionStatus() -> (isAvailable: Bool, subscriptionType: String?) {
        let creds = readCredentials()
        return (creds != nil, creds?.subscriptionType)
    }

    // MARK: - Internal

    private struct Credentials {
        let accessToken: String
        let refreshToken: String
        let expiresAt: Double?
        let subscriptionType: String?
    }

    private static func readCredentials() -> Credentials? {
        // Try Keychain first (newer Claude Code versions), then fall back to JSON file
        if let creds = readFromKeychain() { return creds }
        return readFromFile()
    }

    private static func readFromKeychain() -> Credentials? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }

        return parseCredentialData(data)
    }

    private static func readFromFile() -> Credentials? {
        guard FileManager.default.fileExists(atPath: credPath.path) else { return nil }

        do {
            let data = try Data(contentsOf: credPath)
            return parseCredentialData(data)
        } catch {
            Log.stream.error("Failed to read Claude credentials file: \(error, privacy: .public)")
            return nil
        }
    }

    private static func parseCredentialData(_ data: Data) -> Credentials? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let oauth = json["claudeAiOauth"] as? [String: Any],
              let accessToken = oauth["accessToken"] as? String,
              let refreshToken = oauth["refreshToken"] as? String else {
            return nil
        }

        return Credentials(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: oauth["expiresAt"] as? Double,
            subscriptionType: oauth["subscriptionType"] as? String
        )
    }

    /// Refresh the OAuth token synchronously and update stored credentials.
    private static func refreshTokenSync(refreshToken: String) -> String? {
        final class RefreshedTokenBox: @unchecked Sendable {
            var value: String?
        }

        guard let url = URL(string: tokenEndpoint) else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        let body = "grant_type=refresh_token&refresh_token=\(refreshToken)&client_id=\(oauthClientId)"
        request.httpBody = body.data(using: .utf8)

        let semaphore = DispatchSemaphore(value: 0)
        let refreshedToken = RefreshedTokenBox()

        let task = URLSession.shared.dataTask(with: request) { data, _, error in
            defer { semaphore.signal() }

            guard let data, error == nil else {
                Log.stream.error("Token refresh request failed: \(error?.localizedDescription ?? "unknown", privacy: .public)")
                return
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let accessToken = json["access_token"] as? String else {
                if let errJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let errObj = errJson["error"] as? [String: Any],
                   let msg = errObj["message"] as? String {
                    Log.stream.error("Token refresh error: \(msg, privacy: .public)")
                }
                return
            }

            refreshedToken.value = accessToken

            // Update stored credentials
            updateStoredCredentials(accessToken: accessToken, json: json)
        }
        task.resume()
        semaphore.wait()

        return refreshedToken.value
    }

    private static func updateStoredCredentials(accessToken: String, json: [String: Any]) {
        // Try updating Keychain first, then file
        if updateKeychain(accessToken: accessToken, json: json) { return }
        updateFile(accessToken: accessToken, json: json)
    }

    private static func updateKeychain(accessToken: String, json: [String: Any]) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let existingData = result as? Data else { return false }

        guard var fileJson = try? JSONSerialization.jsonObject(with: existingData) as? [String: Any],
              var oauth = fileJson["claudeAiOauth"] as? [String: Any] else { return false }

        oauth["accessToken"] = accessToken
        if let expiresIn = json["expires_in"] as? Double {
            oauth["expiresAt"] = (Date.now.timeIntervalSince1970 + expiresIn) * 1000.0
        }
        if let newRefresh = json["refresh_token"] as? String {
            oauth["refreshToken"] = newRefresh
        }
        fileJson["claudeAiOauth"] = oauth

        guard let updatedData = try? JSONSerialization.data(withJSONObject: fileJson) else { return false }

        let updateQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
        ]
        let updateAttrs: [String: Any] = [
            kSecValueData as String: updatedData,
        ]

        let updateStatus = SecItemUpdate(updateQuery as CFDictionary, updateAttrs as CFDictionary)
        if updateStatus == errSecSuccess {
            Log.stream.info("Claude OAuth token refreshed and saved to Keychain")
            return true
        }
        return false
    }

    private static func updateFile(accessToken: String, json: [String: Any]) {
        do {
            var fileData = try Data(contentsOf: credPath)
            guard var fileJson = try JSONSerialization.jsonObject(with: fileData) as? [String: Any],
                  var oauth = fileJson["claudeAiOauth"] as? [String: Any] else { return }

            oauth["accessToken"] = accessToken
            if let expiresIn = json["expires_in"] as? Double {
                oauth["expiresAt"] = (Date.now.timeIntervalSince1970 + expiresIn) * 1000.0
            }
            if let newRefresh = json["refresh_token"] as? String {
                oauth["refreshToken"] = newRefresh
            }
            fileJson["claudeAiOauth"] = oauth

            fileData = try JSONSerialization.data(withJSONObject: fileJson)
            try fileData.write(to: credPath, options: .atomic)
            Log.stream.info("Claude OAuth token refreshed and saved to file")
        } catch {
            Log.stream.error("Failed to save refreshed token: \(error, privacy: .public)")
        }
    }
}
