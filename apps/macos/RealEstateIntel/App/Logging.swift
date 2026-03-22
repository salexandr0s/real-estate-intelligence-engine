import os

enum Log {
    static let api = Logger(subsystem: "com.rei.app", category: "API")
    static let data = Logger(subsystem: "com.rei.app", category: "Data")
    static let ui = Logger(subsystem: "com.rei.app", category: "UI")
    static let stream = Logger(subsystem: "com.rei.app", category: "Stream")
}
