import Foundation

/// Reads the API's `/health` answer. It needs no token and answers 200 while the API runs, with a
/// body that says whether Postgres and Redis respond.
struct HealthProbe: Sendable {
    /// `{"status":"ok"|"degraded","checks":{"postgres":"ok"|"error","redis":"ok"|"error"}}`
    struct Report: Decodable, Equatable, Sendable {
        let status: String
        let checks: [String: String]

        /// Which dependency is down, in words, or nil when every check passed.
        var issueMessage: String? {
            let databaseDown = checks["postgres"] == "error"
            let redisDown = checks["redis"] == "error"
            switch (databaseDown, redisDown) {
            case (true, true): return "The database and Redis aren't responding."
            case (true, false): return "The database isn't responding."
            case (false, true): return "Redis isn't responding."
            case (false, false): return nil
            }
        }
    }

    static let timeout: TimeInterval = 2

    /// The report, or nil when `/health` didn't answer in time or its answer couldn't be read.
    func check(baseURL: String) async -> Report? {
        var root = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while root.hasSuffix("/") {
            root.removeLast()
        }
        // Built like the API client builds its paths, so a base URL with a path prefix works too.
        guard let url = URL(string: root + "/health") else { return nil }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: Self.timeout)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            return nil
        }
        return try? JSONDecoder().decode(Report.self, from: data)
    }
}
