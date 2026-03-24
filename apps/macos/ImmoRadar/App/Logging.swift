import os

enum Log {
    static let api = Logger(subsystem: "com.immoradar.app", category: "API")
    static let data = Logger(subsystem: "com.immoradar.app", category: "Data")
    static let ui = Logger(subsystem: "com.immoradar.app", category: "UI")
    static let stream = Logger(subsystem: "com.immoradar.app", category: "Stream")
}
