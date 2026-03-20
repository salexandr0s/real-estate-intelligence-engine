import Foundation

/// EUR price formatting utilities with proper locale handling.
enum PriceFormatter {

    // MARK: - Shared Formatters

    private static let eurFormatter: NumberFormatter = {
        let fmt = NumberFormatter()
        fmt.numberStyle = .currency
        fmt.currencyCode = "EUR"
        fmt.currencySymbol = "EUR"
        fmt.maximumFractionDigits = 0
        fmt.locale = Locale(identifier: "de_AT")
        return fmt
    }()

    private static let eurDecimalFormatter: NumberFormatter = {
        let fmt = NumberFormatter()
        fmt.numberStyle = .currency
        fmt.currencyCode = "EUR"
        fmt.currencySymbol = "EUR"
        fmt.maximumFractionDigits = 2
        fmt.minimumFractionDigits = 2
        fmt.locale = Locale(identifier: "de_AT")
        return fmt
    }()

    private static let compactFormatter: NumberFormatter = {
        let fmt = NumberFormatter()
        fmt.numberStyle = .decimal
        fmt.maximumFractionDigits = 0
        fmt.locale = Locale(identifier: "de_AT")
        return fmt
    }()

    private static let percentFormatter: NumberFormatter = {
        let fmt = NumberFormatter()
        fmt.numberStyle = .percent
        fmt.maximumFractionDigits = 1
        fmt.minimumFractionDigits = 1
        fmt.locale = Locale(identifier: "de_AT")
        return fmt
    }()

    // MARK: - Public Methods

    /// Format whole-euro prices: "EUR 299.000"
    static func format(eur amount: Int) -> String {
        eurFormatter.string(from: NSNumber(value: amount)) ?? "EUR \(amount)"
    }

    /// Format price per sqm with decimals: "EUR 4.124,14"
    static func formatPerSqm(_ amount: Double) -> String {
        eurDecimalFormatter.string(from: NSNumber(value: amount)) ?? "EUR \(amount)"
    }

    /// Format area: "72,5 m2"
    static func formatArea(_ sqm: Double) -> String {
        let formatted = sqm.formatted(
            .number
            .precision(.fractionLength(1))
            .locale(Locale(identifier: "de_AT"))
        )
        return "\(formatted) m\u{00B2}"
    }

    /// Compact number: "299.000"
    static func formatCompact(_ value: Int) -> String {
        compactFormatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Percentage: "15,4 %"
    static func formatPercent(_ value: Double) -> String {
        percentFormatter.string(from: NSNumber(value: value)) ?? "\(value * 100)%"
    }

    /// Short relative date: "3h ago", "2d ago"
    static func relativeDate(_ date: Date) -> String {
        let interval = Date.now.timeIntervalSince(date)
        let minutes = Int(interval / 60)
        let hours = Int(interval / 3600)
        let days = Int(interval / 86400)

        if minutes < 1 { return "just now" }
        if minutes < 60 { return "\(minutes)m ago" }
        if hours < 24 { return "\(hours)h ago" }
        if days < 30 { return "\(days)d ago" }
        return dateFormatter.string(from: date)
    }

    private static let dateFormatter: DateFormatter = {
        let fmt = DateFormatter()
        fmt.dateStyle = .medium
        fmt.timeStyle = .none
        fmt.locale = Locale(identifier: "de_AT")
        return fmt
    }()

    /// Medium date format: "20. Mar. 2026"
    static func formatDate(_ date: Date) -> String {
        dateFormatter.string(from: date)
    }

    private static let dateTimeFormatter: DateFormatter = {
        let fmt = DateFormatter()
        fmt.dateFormat = "dd.MM.yyyy HH:mm"
        fmt.locale = Locale(identifier: "de_AT")
        return fmt
    }()

    /// Date with time: "20.03.2026 14:32"
    static func formatDateTime(_ date: Date) -> String {
        dateTimeFormatter.string(from: date)
    }
}
