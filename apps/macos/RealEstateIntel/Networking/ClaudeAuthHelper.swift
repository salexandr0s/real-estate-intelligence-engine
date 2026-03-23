import Foundation
import os

/// Reads and refreshes OAuth credentials from the Claude CLI credentials file (~/.claude/.credentials.json).
enum ClaudeAuthHelper {

    private static let credPath: URL = {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/.credentials.json")
    }()

    /// Claude Code's OAuth client ID (used for token refresh).
    private static let oauthClientId = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
    private static let tokenEndpoint = "https://console.anthropic.com/v1/oauth/token"

    // MARK: - Public API

    /// Reads the OAuth access token, refreshing if expired.
    static func loadOAuthToken() -> String? {
        guard let creds = readCredentials() else { return nil }

        // If token is still valid, return it directly
        if let expiresAt = creds.expiresAt {
            let expiryDate = Date(timeIntervalSince1970: expiresAt / 1000.0)
            if expiryDate > Date() {
                return creds.accessToken
            }
        }

        // Token expired — try to refresh synchronously
        Log.stream.info("Claude OAuth token expired, attempting refresh...")
        if let refreshed = refreshTokenSync(refreshToken: creds.refreshToken) {
            return refreshed
        }

        // Refresh failed — return the stale token anyway (API will reject if truly expired)
        Log.stream.warning("Token refresh failed, using stale token")
        return creds.accessToken
    }

    /// Check if a Claude subscription is available.
    static var isAvailable: Bool {
        readCredentials() != nil
    }

    /// Returns the subscription type if available (e.g., "max", "pro").
    static var subscriptionType: String? {
        readCredentials()?.subscriptionType
    }

    // MARK: - Internal

    private struct Credentials {
        let accessToken: String
        let refreshToken: String
        let expiresAt: Double?
        let subscriptionType: String?
    }

    private static func readCredentials() -> Credentials? {
        guard FileManager.default.fileExists(atPath: credPath.path) else { return nil }

        do {
            let data = try Data(contentsOf: credPath)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
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
        } catch {
            Log.stream.error("Failed to read Claude credentials: \(error, privacy: .public)")
            return nil
        }
    }

    /// Refresh the OAuth token synchronously and update the credentials file.
    private static func refreshTokenSync(refreshToken: String) -> String? {
        guard let url = URL(string: tokenEndpoint) else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        let body = "grant_type=refresh_token&refresh_token=\(refreshToken)&client_id=\(oauthClientId)"
        request.httpBody = body.data(using: .utf8)

        let semaphore = DispatchSemaphore(value: 0)
        var newToken: String?

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

            newToken = accessToken

            // Update the credentials file with the new token
            do {
                var fileData = try Data(contentsOf: credPath)
                guard var fileJson = try JSONSerialization.jsonObject(with: fileData) as? [String: Any],
                      var oauth = fileJson["claudeAiOauth"] as? [String: Any] else { return }

                oauth["accessToken"] = accessToken
                if let expiresIn = json["expires_in"] as? Double {
                    oauth["expiresAt"] = (Date().timeIntervalSince1970 + expiresIn) * 1000.0
                }
                if let newRefresh = json["refresh_token"] as? String {
                    oauth["refreshToken"] = newRefresh
                }
                fileJson["claudeAiOauth"] = oauth

                fileData = try JSONSerialization.data(withJSONObject: fileJson)
                try fileData.write(to: credPath, options: .atomic)
                Log.stream.info("Claude OAuth token refreshed and saved")
            } catch {
                Log.stream.error("Failed to save refreshed token: \(error, privacy: .public)")
            }
        }
        task.resume()
        semaphore.wait()

        return newToken
    }
}
